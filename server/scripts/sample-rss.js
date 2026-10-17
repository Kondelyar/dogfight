// node scripts/sample-rss.js [url] [секунди] - раз на секунду пише "час,rss_mb" (CSV для графіка)
const url = process.argv[2] ?? 'http://localhost:3000/health';
const seconds = Number(process.argv[3] ?? 60);

console.log('t,rss_mb');
for (let t = 0; t < seconds; t++) {
  const { rssMb } = await (await fetch(url)).json();
  console.log(`${t},${rssMb}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
