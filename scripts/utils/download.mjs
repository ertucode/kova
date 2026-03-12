// scripts/utils/download.mjs
import https from "https";
import { createWriteStream } from "fs";
import { URL } from "url";

/**
 * Download a file with redirect support.
 *
 * @param {string} url - URL to download
 * @param {string} dest - Local file path
 * @param {number} maxRedirects - Redirect limit
 */
export function download(url, dest, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // handle redirects
        if (
          [301, 302, 307, 308].includes(res.statusCode) &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).toString();

          console.log(`Redirect → ${next}`);
          return resolve(download(next, dest, maxRedirects - 1));
        }

        // require OK status
        if (res.statusCode !== 200) {
          return reject(
            new Error(`HTTP ${res.statusCode} while downloading ${url}`),
          );
        }

        const file = createWriteStream(dest);

        res.pipe(file);

        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}
