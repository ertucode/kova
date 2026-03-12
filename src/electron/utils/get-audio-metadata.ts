import { parseFile } from "music-metadata";
import { expandHome } from "./expand-home.js";

export type AudioMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string[];
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
  numberOfChannels?: number;
  picture?: {
    data: string; // base64 encoded
    format: string;
  };
};

export async function getAudioMetadata(
  filePath: string,
): Promise<AudioMetadata | { error: string }> {
  try {
    const fullPath = expandHome(filePath);
    const metadata = await parseFile(fullPath);

    const result: AudioMetadata = {
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album,
      year: metadata.common.year,
      genre: metadata.common.genre,
      duration: metadata.format.duration,
      bitrate: metadata.format.bitrate,
      sampleRate: metadata.format.sampleRate,
      numberOfChannels: metadata.format.numberOfChannels,
    };

    // Handle album art if present
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0];
      result.picture = {
        data: Buffer.from(picture.data).toString("base64"),
        format: picture.format,
      };
    }

    return result;
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Unknown error reading audio metadata" };
  }
}
