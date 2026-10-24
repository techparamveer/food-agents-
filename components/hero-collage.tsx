import type { CSSProperties } from "react";

type Shape = "portrait" | "landscape" | "square";

const PHOTOS: Record<Shape, string[]> = {
  portrait: ["portrait-01", "portrait-02", "portrait-03"],
  landscape: ["landscape-01", "landscape-02", "landscape-03"],
  square: ["square-01", "square-02", "square-03"],
};

const RATIO: Record<Shape, string> = {
  portrait: "3 / 4",
  landscape: "4 / 3",
  square: "1 / 1",
};

const TINTS = ["#fcd28a", "#fcd28a", "#fbc690", "#ecdfc9"];

type LayerConfig = {
  seed: number;
  count: number;
  size: [number, number];
  duration: [number, number];
};

const LAYERS: { name: "back" | "front"; config: LayerConfig }[] = [
  { name: "back", config: { seed: 7, count: 22, size: [70, 120], duration: [90, 120] } },
  { name: "front", config: { seed: 19, count: 14, size: [120, 200], duration: [60, 80] } },
];

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTiles({ seed, count, size, duration }: LayerConfig) {
  const rand = mulberry32(seed);
  const shapes: Shape[] = ["portrait", "landscape", "square"];

  return Array.from({ length: count }, (_, i) => {
    const shape = shapes[Math.floor(rand() * shapes.length)];
    const photos = PHOTOS[shape];
    const width = Math.round(size[0] + rand() * (size[1] - size[0]));
    const dur = duration[0] + rand() * (duration[1] - duration[0]);
    // Spread tiles evenly through the loop so the field is full on first paint.
    const phase = (i + rand() * 0.6) / count;

    return {
      key: `${seed}-${i}`,
      src: `/collage/collage-${photos[Math.floor(rand() * photos.length)]}.jpg`,
      style: {
        "--x": (i / count + rand() * 0.08) % 1,
        "--w": `${shape === "portrait" ? Math.round(width * 0.75) : width}px`,
        "--ratio": RATIO[shape],
        "--tint": TINTS[Math.floor(rand() * TINTS.length)],
        "--dur": `${dur.toFixed(1)}s`,
        "--delay": `${(-phase * dur).toFixed(1)}s`,
        "--in": `${(0.9 + rand() * 1.6).toFixed(2)}s`,
      } as CSSProperties,
    };
  });
}

const TILES = LAYERS.map(({ name, config }) => ({ name, tiles: buildTiles(config) }));

export function HeroCollage() {
  return (
    <div className="collage" aria-hidden="true">
      {TILES.map(({ name, tiles }) => (
        <div className={`collage__layer collage__layer--${name}`} key={name}>
          {tiles.map((tile) => (
            <div className="collage__col" style={tile.style} key={tile.key}>
              <div className="collage__tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={tile.src} alt="" loading="eager" decoding="async" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
