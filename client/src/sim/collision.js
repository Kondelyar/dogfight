// наївний O(n^2) прохід - для кількох десятків сутностей цього досить
// (Lab 7 заміряє і при потребі поміняє на просторовий хеш)
export function* findCollisions(world) {
  const entities = [...world];

  for (let i = 0; i < entities.length; i++) {
    const a = entities[i];
    if (!a.alive) continue;

    for (let j = i + 1; j < entities.length; j++) {
      const b = entities[j];
      if (!b.alive) continue;

      const dx = a.pos.x - b.pos.x;
      const dy = a.pos.y - b.pos.y;
      const minDist = a.radius + b.radius;

      if (dx * dx + dy * dy <= minDist * minDist) {
        yield [a, b];
      }
    }
  }
}
