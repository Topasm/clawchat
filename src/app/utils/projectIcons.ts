/**
 * Deterministic project icon assignment based on project ID.
 * Each project gets a unique-looking avatar emoji from a curated pool.
 */

const PROJECT_ICONS = [
  // Animals
  '\u{1F431}', // cat
  '\u{1F436}', // dog
  '\u{1F43B}', // bear
  '\u{1F98A}', // fox
  '\u{1F43C}', // panda
  '\u{1F430}', // rabbit
  '\u{1F989}', // owl
  '\u{1F981}', // lion
  '\u{1F427}', // penguin
  '\u{1F40B}', // whale
  '\u{1F985}', // eagle
  '\u{1F984}', // unicorn
  '\u{1F99C}', // parrot
  '\u{1F43A}', // wolf
  '\u{1F994}', // hedgehog
  // Characters / People
  '\u{1F916}', // robot
  '\u{1F9D9}', // mage
  '\u{1F477}', // construction worker
  '\u{1F9D1}\u{200D}\u{1F4BB}', // technologist
  '\u{1F9D1}\u{200D}\u{1F3A8}', // artist
  '\u{1F9D1}\u{200D}\u{1F52C}', // scientist
  '\u{1F9D1}\u{200D}\u{1F680}', // astronaut
  '\u{1F9DA}', // fairy
  '\u{1F47E}', // alien monster
  '\u{1F9DE}', // genie
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getProjectIcon(projectId: string): string {
  const index = hashString(projectId) % PROJECT_ICONS.length;
  return PROJECT_ICONS[index];
}
