# Kokoro TTS Processor

## Node.js Setup

1. Install dependencies:

```bash
npm install
```

2. Create an `input.txt` file with your text

3. Run commands:

```bash
# List available voices
node kokoro-js-test.mjs --voices

# Test text chunking
node kokoro-js-test.mjs --test-chunks

# Generate audio (default voice: af)
node kokoro-js-test.mjs

# Generate audio with specific voice
node kokoro-js-test.mjs af_sarah
```

## Docker/Podman Setup

1. Build the image:

```bash
podman build -t kokoro-js-test .
```

2. Run commands:

```bash
# List voices
podman run --rm kokoro-js-test --voices

# Test chunks
podman run --rm -v ./:/data:Z kokoro-js-test --test-chunks

# Generate audio with specific voice
podman run --rm -v ./:/data:Z kokoro-js-test af_sarah
```

### Docker/Podman Notes

- The `-v ./:/data:Z` mounts your current directory to /data in the container
- The `:Z` is important for SELinux systems (like RHEL/Fedora)
- Input.txt should be in your current directory
- Output.wav will be created in your current directory
