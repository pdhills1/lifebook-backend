const sharp = require('sharp');
const { invalid } = require('./errors');

const FRIENDLY_FORMATS = 'JPG, PNG, GIF or WebP';

/**
 * Turns whatever the person uploaded into a sensible JPEG: right way up, not enormous.
 * Keeps storage small and the PDF quick to build without visibly hurting quality.
 */
async function normalisePhoto(buffer, filename = '') {
  try {
    const out = await sharp(buffer, { failOn: 'none', limitInputPixels: 120e6 })
      .rotate() // honour the camera's orientation, then drop the metadata
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // transparent PNGs become white, not black
      .jpeg({ quality: 85, progressive: true })
      .toBuffer({ resolveWithObject: true });
    return { buffer: out.data, width: out.info.width, height: out.info.height };
  } catch (err) {
    const heic = /\.(heic|heif)$/i.test(filename);
    throw invalid(
      heic
        ? `iPhone-style HEIC photos can't be used yet. Please choose a ${FRIENDLY_FORMATS} version (sharing the photo from your phone as "Most Compatible" does this).`
        : `We couldn't read that photo. Please try a ${FRIENDLY_FORMATS} file.`
    );
  }
}

module.exports = { normalisePhoto };
