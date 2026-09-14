export function downloadText(name: string, text: string): void {
  download(name, new Blob([text], { type: 'text/plain;charset=utf-8' }));
}

export function downloadBytes(name: string, bytes: Uint8Array): void {
  download(
    name,
    new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/wasm' }),
  );
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start the download before dropping the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
