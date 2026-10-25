/* Browser QR decoding. Uses the native BarcodeDetector where it reads QR codes (Chrome on
   Android, Safari 17+ on iOS and macOS), otherwise the `barcode-detector` ponyfill
   (ZXing-C++ compiled to WebAssembly). The .wasm is self-hosted from /public/vendor, never a CDN.
   After upgrading `barcode-detector`, copy node_modules/zxing-wasm/dist/reader/zxing_reader.wasm
   to public/vendor/ again. */

export type QrDetector = {
  detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
};

export type QrEngine = "native" | "wasm";

type NativeCtor = {
  new (options: { formats: string[] }): QrDetector;
  getSupportedFormats: () => Promise<string[]>;
};

let cached: Promise<{ detector: QrDetector; engine: QrEngine }> | null = null;

async function nativeDetector(): Promise<QrDetector | null> {
  const Native = (globalThis as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
  if (!Native) return null;
  try {
    const formats = await Native.getSupportedFormats();
    return formats.includes("qr_code") ? new Native({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

export function createQrDetector() {
  cached ??= (async () => {
    const native = await nativeDetector();
    if (native) return { detector: native, engine: "native" as const };
    const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/vendor/${path}` : prefix + path),
      },
    });
    return { detector: new BarcodeDetector({ formats: ["qr_code"] }) as QrDetector, engine: "wasm" as const };
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}
