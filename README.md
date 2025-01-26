1. Build the image:

```bash
podman build -t kokoro-js-test .
```

2. Run the container with different commands:

List voices:

```bash
podman run --rm kokoro-js-test --voices
```

Test chunks:

```bash
podman run --rm -v ./:/data:Z kokoro-js-test --test-chunks
```

Generate audio with specific voice:

```bash
podman run --rm -v ./:/data:Z kokoro-js-test af_sarah
```

Notes:

- The `-v ./:/data:Z` mounts your current directory to /data in the container
- The `:Z` is important for SELinux systems (like RHEL/Fedora)
- Input.txt should be in your current directory
- Output.wav will be created in your current directory
