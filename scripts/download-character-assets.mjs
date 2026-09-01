import { mkdir, writeFile } from 'node:fs/promises';

const outputDir = new URL('../assets/characters/', import.meta.url);
await mkdir(outputDir, { recursive: true });

const characters = [
  ['ryu','character_ryu_l.png'], ['luke','character_luke_l.png'], ['jamie','character_jamie_l.png'],
  ['chunli','character_chunli_l.png'], ['guile','character_guile_l.png'], ['kimberly','character_kimberly_l.png'],
  ['juri','character_juri_l.png'], ['ken','character_ken_l.png'], ['blanka','character_blanka_l.png'],
  ['dhalsim','character_dhalsim_l.png'], ['honda','character_honda_l.png'], ['zangief','character_zangief_l.png'],
  ['cammy','character_cammy_l.png'], ['manon','character_manon_l.png'], ['marisa','character_marisa_l.png'],
  ['lily','character_lily_l.png'], ['jp','character_jp_l.png'], ['deejay','character_deejay_l.png'],
  ['rashid','character_rashid_l.png'], ['aki','character_aki_l.png'], ['ed','character_ed_l.png'],
  ['gouki','character_gouki_l.png'], ['terry','character_terry_l.png'], ['mai','character_mai_l.png'],
  ['vega','character_vega_l.png'], ['elena','character_elena_l.png'], ['sagat','character_sagat_l.png'],
  ['cviper','character_cviper_l.png'], ['alex','character_alex_l.png'], ['ingrid','character_ingrid_l.png'],
  ['yasmine','character_yasmine_l.png'],
];

const base = 'https://www.streetfighter.com/6/buckler/assets/images/material/character/';

for (const [slug, filename] of characters) {
  const response = await fetch(`${base}${filename}`, {
    headers: { 'user-agent': 'SF6LiveResearcher character asset downloader' },
  });
  if (!response.ok) {
    console.warn(`skip ${slug}: HTTP ${response.status}`);
    continue;
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('image')) {
    console.warn(`skip ${slug}: unexpected content-type ${contentType}`);
    continue;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(filename, outputDir), bytes);
  console.log(`downloaded ${slug}: ${bytes.length} bytes`);
}
