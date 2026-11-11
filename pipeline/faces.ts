import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import ort from 'onnxruntime-node';

// Anime face detection for Guess the Anime screenshots (step `screenshots`): a frame with a character's
// face in it is far easier to place than sky, scenery or staff credits. Model: deepghs/anime_face_detection
// face_detect_v1.4_n (YOLOv8n, MIT, 12 MB), fetched once into data/models (gitignored).

const MODEL_URL = 'https://huggingface.co/deepghs/anime_face_detection/resolve/main/face_detect_v1.4_n/model.onnx';
const MODEL_FILE = 'data/models/face_detect_v1.4_n.onnx';
/** The model card's best-F1 confidence threshold for v1.4_n. */
const THRESHOLD = 0.278;
/** Frames go in as DETECT_SIZE² RGB, letterboxed (ffmpeg `scale…decrease,pad`). */
export const DETECT_SIZE = 640;
export const DETECT_FILTER = `scale=${DETECT_SIZE}:${DETECT_SIZE}:force_original_aspect_ratio=decrease,pad=${DETECT_SIZE}:${DETECT_SIZE}:-1:-1:color=0x727272,format=rgb24`;

/** Returns a function giving the area of the largest face in a DETECT_FILTER frame, as a share of the frame (0 = none). */
export async function faceDetector(): Promise<(rgb: Uint8Array) => Promise<number>> {
  if (!existsSync(MODEL_FILE)) {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`model wajah: ${res.status}`);
    await mkdir('data/models', { recursive: true });
    await writeFile(MODEL_FILE, new Uint8Array(await res.arrayBuffer()));
  }
  const session = await ort.InferenceSession.create(MODEL_FILE);
  const pixels = DETECT_SIZE * DETECT_SIZE;
  return async (rgb) => {
    // HWC bytes → CHW floats in [0, 1].
    const input = new Float32Array(3 * pixels);
    for (let p = 0; p < pixels; p++) for (let c = 0; c < 3; c++) input[c * pixels + p] = rgb[p * 3 + c]! / 255;
    const output = (await session.run({ [session.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, DETECT_SIZE, DETECT_SIZE]) }))[session.outputNames[0]!]!;
    // YOLOv8, one class: [1, 5, anchors] = cx, cy, w, h, confidence per anchor.
    const data = output.data as Float32Array;
    const anchors = output.dims[2]!;
    let largest = 0;
    for (let i = 0; i < anchors; i++) {
      if (data[4 * anchors + i]! < THRESHOLD) continue;
      largest = Math.max(largest, (data[2 * anchors + i]! * data[3 * anchors + i]!) / pixels);
    }
    return largest;
  };
}
