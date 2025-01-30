import { KokoroTTS } from "kokoro-js";
import { readFile, writeFile, unlink } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Function to process footnotes in text
function processFootnotes(text) {
  // First, collect all footnotes from the bottom of the text
  const footnoteMap = new Map();
  
  // Find footnotes at the end of the text
  // Look for [n] followed by text until the next [n] or end of text
  const footnoteRegex = /\[(\d+)\]\s*([^[]+)(?=\[\d+\]|\s*$)/g;
  
  let match;
  while ((match = footnoteRegex.exec(text)) !== null) {
    const num = match[1];
    const content = match[2].trim();
    footnoteMap.set(num, content);
  }

  // Replace footnote references in the main text
  // Split at the second occurrence of [1] which starts the footnotes section
  const firstIndex = text.indexOf('[1]');
  const secondIndex = text.indexOf('[1]', firstIndex + 1);
  let mainText = secondIndex > -1 ? text.substring(0, secondIndex) : text;

  mainText = mainText.replace(/\[(\d+)\]/g, (match, num) => {
    const footnote = footnoteMap.get(num);
    return footnote ? ` (footnote: ${footnote}) ` : match;
  });

  return mainText.trim();
}

// Function to chunk text into segments, preferably at sentence boundaries
function chunkText(text, maxTokens = 51, maxChars = 250) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let currentChunk = '';

  for (let sentence of sentences) {
    // If single sentence is too long, split it into smaller parts
    if (sentence.length > maxChars) {
      // First try splitting on semicolons
      let parts = sentence.split(/;\s*/);
      
      // If parts are still too long, try commas
      if (parts.some(p => p.length > maxChars)) {
        parts = sentence.split(/,\s*/);
      }
      
      // If still too long, split on spaces
      if (parts.some(p => p.length > maxChars)) {
        parts = sentence.split(/\s+/);
      }

      // Process each part
      for (const part of parts) {
        if ((currentChunk + ' ' + part).trim().length > maxChars) {
          if (currentChunk) chunks.push(currentChunk.trim());
          currentChunk = part;
        } else {
          currentChunk += (currentChunk ? ' ' : '') + part;
        }
      }
      continue;
    }

    // Normal sentence processing
    const estimatedTokens = sentence.split(/\s+/).length + 1;
    if ((currentChunk.split(/\s+/).length + estimatedTokens) > maxTokens || 
        (currentChunk + ' ' + sentence).length > maxChars) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

async function initializeTTS(dtype = "fp32") {
  const model_id = "onnx-community/Kokoro-82M-ONNX";
  return await KokoroTTS.from_pretrained(model_id, { dtype });
}

async function displayChunks(text, processedText, chunks) {
  console.log('Original text:\n', text);
  console.log('\nProcessed text (with footnotes inline):\n', processedText);
  console.log('\nChunks:');
  chunks.forEach((chunk, index) => {
    console.log(`\nChunk ${index + 1}/${chunks.length} (${chunk.length} chars):`);
    console.log(chunk);
  });
}

async function main() {
  try {
    const startTime = Date.now();

    // Read text from input file
    const text = await readFile('input.txt', 'utf-8');
    console.log('Processing text...');
    
    // Process footnotes
    const processedText = processFootnotes(text);
    
    // Split text into chunks
    const chunks = chunkText(processedText);
    console.log(`Split into ${chunks.length} chunks`);

    // If testing chunks, display and exit
    if (process.argv.includes('--test-chunks')) {
      await displayChunks(text, processedText, chunks);
      return;
    }

    // Initialize TTS with appropriate dtype
    const dtype = process.argv.includes('--voices') ? "q8" : "fp32";
    const tts = await initializeTTS(dtype);

    // If listing voices, display and exit
    if (process.argv.includes('--voices')) {
      console.log('Available voices:');
      const voices = await tts.list_voices();
      console.log(voices);
      return;
    }

    // Get voice from command line argument or use default
    const selectedVoice = process.argv[2] || "af";
    console.log(`Using voice: ${selectedVoice}`);
    
    // Generate audio for each chunk
    const audioFiles = [];
    let lastChunkDuration = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkStartTime = Date.now();
      
      // Move cursor to beginning of line and clear to end
      process.stdout.write('\r\x1b[K');
      const prevChunkInfo = i > 0 ? `Previous chunk took ${lastChunkDuration.toFixed(2)}s. ` : '';
      process.stdout.write(`${prevChunkInfo}Processing chunk ${i + 1}/${chunks.length}...`);
      
      const audio = await tts.generate(chunks[i], {
        voice: selectedVoice,
      });
      
      const tempFileName = `chunk_${i}.wav`;
      await audio.save(tempFileName);
      audioFiles.push(tempFileName);
      
      lastChunkDuration = (Date.now() - chunkStartTime) / 1000;
    }
    
    // Final newline and show last chunk duration
    process.stdout.write(`\nFinal chunk completed in ${lastChunkDuration.toFixed(2)}s\n`);
    
    // Merge audio files
    try {
      if (audioFiles.length === 1) {
        // If only one chunk, just copy the content
        const content = await readFile(audioFiles[0]);
        await writeFile('output.wav', content);
        console.log('Single file saved as output.wav');
      } else {
        // Create a file list for ffmpeg
        const fileList = audioFiles.map(f => `file '${f}'`).join('\n');
        await writeFile('files.txt', fileList);

        // Merge multiple chunks using ffmpeg
        console.log('Merging files...');
        // console.log('Merging files:', audioFiles);
        const { stdout, stderr } = await execAsync('ffmpeg -y -f concat -safe 0 -i files.txt -c copy output.wav');
        // if (stderr) console.log('FFmpeg messages:', stderr); // a lot of logs
        await unlink('files.txt'); // Clean up the file list
        console.log('Merged files saved as output.wav');
      }
      
      // Verify the output file exists, was just created, and has content
      const { statSync } = await import('fs');
      const fileStats = statSync('output.wav');
      const fileCreationTime = fileStats.birthtimeMs;
      
      if (fileCreationTime < startTime) {
        console.warn('\x1b[33mWARNING: Output file appears to be from a previous run!\x1b[0m');
      }
      
      const sizeInMB = (fileStats.size / (1024 * 1024)).toFixed(2);
      const sizeInKB = (fileStats.size / 1024).toFixed(2);
      const readableSize = fileStats.size > 1024 * 1024 
        ? `${sizeInMB} MB` 
        : `${sizeInKB} KB`;
      console.log(`Output file size: ${readableSize}`);
      console.log(`File creation time: ${new Date(fileCreationTime).toLocaleString()}`);
      
      // Clean up temporary files
      await Promise.all(audioFiles.map(file => unlink(file)));
      console.log(`Cleaned up ${audioFiles.length} temporary files`);
    } catch (error) {
      console.error('Error during file merging:', error);
      // Don't clean up temp files on error so we can inspect them
      throw error;
    }

    
    const totalSeconds = (Date.now() - startTime) / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    console.log(`Audio file generated successfully! Total processing time: ${minutes}m ${seconds}s`);
  } catch (error) {
    console.error("Error generating audio:", error);
    process.exit(1);
  }
}

main();
