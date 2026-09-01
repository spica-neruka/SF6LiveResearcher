// Always resolve SF6 character artwork from the official Street Fighter website.
// This intentionally does not depend on GitHub Pages/local character assets.
const SF6_CHARACTER_IMAGE_BASE = 'https://www.streetfighter.com/6/buckler/assets/images/material/character/character_';

function applyOfficialCharacterImages(root = document) {
  root.querySelectorAll('[style*="assets/characters/character_"]').forEach((el) => {
    const match = el.getAttribute('style')?.match(/assets\/characters\/character_([a-z0-9]+)_l\.png/i);
    if (!match) return;

    const slug = match[1].toLowerCase();
    const officialUrl = `${SF6_CHARACTER_IMAGE_BASE}${slug}_l.png`;
    const current = el.getAttribute('style');
    el.setAttribute('style', current.replace(/(?:\.\/)?assets\/characters\/character_[a-z0-9]+_l\.png/gi, officialUrl));
  });
}

// app.js renders pages dynamically, so also watch for newly-created character cards.
const officialCharacterImageObserver = new MutationObserver(() => applyOfficialCharacterImages());

document.addEventListener('DOMContentLoaded', () => {
  applyOfficialCharacterImages();
  officialCharacterImageObserver.observe(document.body, { childList: true, subtree: true });
});
