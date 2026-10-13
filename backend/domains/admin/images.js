"use strict";
const crypto = require("node:crypto");
const MAX_BYTES = 5 * 1024 * 1024;

function decodeImage(value) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(MAX_BYTES / 3) * 4 + 100
  )
    return null;
  const match =
    /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;
  const content = Buffer.from(match[2], "base64");
  if (
    !content.length ||
    content.length > MAX_BYTES ||
    content.toString("base64") !== match[2]
  )
    return null;
  const extension = match[1].toLowerCase().replace("jpeg", "jpg");
  const valid =
    extension === "png"
      ? content
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : extension === "jpg"
        ? content[0] === 255 && content[1] === 216 && content[2] === 255
        : content.toString("ascii", 0, 4) === "RIFF" &&
          content.toString("ascii", 8, 12) === "WEBP";
  if (!valid) return null;
  return {
    content,
    mime: `image/${extension === "jpg" ? "jpeg" : extension}`,
    filename: `${crypto.createHash("sha256").update(content).digest("hex")}.${extension}`,
  };
}
module.exports = { decodeImage, MAX_BYTES };
