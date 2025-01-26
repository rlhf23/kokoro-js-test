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

async function main() {
  try {
    // chunking test
    if (process.argv.includes('--test-chunks')) {
      const text = await readFile('input.txt', 'utf-8');
      console.log('Original text:\n', text);
      
      const processedText = processFootnotes(text);
      console.log('\nProcessed text (with footnotes inline):\n', processedText);
      
      console.log('\nChunks:');
      const chunks = chunkText(processedText);
      chunks.forEach((chunk, index) => {
        console.log(`\nChunk ${index + 1}/${chunks.length} (${chunk.length} chars):`);
        console.log(chunk);
      });
      return;
    }
    // Check if user wants to list voices
    if (process.argv.includes('--voices')) {
      const model_id = "onnx-community/Kokoro-82M-ONNX";
      const tts = await KokoroTTS.from_pretrained(model_id, {
        dtype: "q8",
      });
      console.log('Available voices:');
      const voices = await tts.list_voices();
      console.log(voices);
      return;
    }

    const startTime = Date.now();
    const model_id = "onnx-community/Kokoro-82M-ONNX";
    const tts = await KokoroTTS.from_pretrained(model_id, {
      dtype: "q8", // Options: "fp32", "fp16", "q8", "q4", "q4f16"
    });

    // Get voice from command line argument or use default
    const selectedVoice = process.argv[2] || "af";
    console.log(`Using voice: ${selectedVoice}`);

    // Read text from input file
    const text = await readFile('input.txt', 'utf-8');
    console.log('Processing text...');
    
    // Process footnotes
    const processedText = processFootnotes(text);
    
    // Split text into chunks
    const chunks = chunkText(text);
    console.log(`Split into ${chunks.length} chunks`);
    
    // Generate audio for each chunk
    const audioFiles = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkStartTime = Date.now();
      process.stdout.write(`Processing chunk ${i + 1}/${chunks.length}... `);
      const audio = await tts.generate(chunks[i], {
        voice: selectedVoice,
      });
      
      const tempFileName = `chunk_${i}.wav`;
      await audio.save(tempFileName);
      audioFiles.push(tempFileName);
      
      const chunkDuration = (Date.now() - chunkStartTime) / 1000;
      console.log(`done in ${chunkDuration.toFixed(2)}s`);
    }
    
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
        console.log('Merging files:', audioFiles);
        const { stdout, stderr } = await execAsync('ffmpeg -y -f concat -safe 0 -i files.txt -c copy output.wav');
        // if (stderr) console.log('FFmpeg messages:', stderr); // a lot of logs
        await unlink('files.txt'); // Clean up the file list
        console.log('Merged files saved as output.wav');
      }
      
      // Verify the output file exists and has content
      const stats = await readFile('output.wav');
      const sizeInMB = (stats.length / (1024 * 1024)).toFixed(2);
      const sizeInKB = (stats.length / 1024).toFixed(2);
      const readableSize = stats.length > 1024 * 1024 
        ? `${sizeInMB} MB` 
        : `${sizeInKB} KB`;
      console.log(`Output file size: ${readableSize}`);
      
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
