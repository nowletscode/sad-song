// Node 18+ (no dependencies).
// Reads your recent Last.fm scrobbles, finds the newest one that's on sad-songs.txt,
// and uploads sad.json to your Neocities site.
//
// Env vars: LASTFM_API_KEY, LASTFM_USER, NEOCITIES_API_KEY
import fs from "node:fs";

const { LASTFM_API_KEY, LASTFM_USER, NEOCITIES_API_KEY } = process.env;

// Lowercase; drop accents, "(Remastered)" tags and punctuation
const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// sad-songs.txt lines look like "Artist - Title" (several artists can be separated by commas)
const sadList = fs.readFileSync(new URL("./sad-songs.txt", import.meta.url), "utf8")
  .split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"))
  .map(line => {
    const i = line.indexOf(" - ");
    if (i === -1) return { title: norm(line), artists: [] };
    return { artists: line.slice(0, i).split(",").map(norm), title: norm(line.slice(i + 3)) };
  });

const isSad = (name, artistName) => {
  // Drop suffixes like "Army Dreamers - 2018 Remaster"
  const t = norm(name.split(" - ")[0]);
  const a = norm(artistName);
  return sadList.some(s => s.title === t &&
    (!s.artists.length || s.artists.some(x => a.includes(x) || x.includes(a))));
};

// 1. Last 200 scrobbles, newest first
const params = new URLSearchParams({
  method: "user.getrecenttracks", user: LASTFM_USER, api_key: LASTFM_API_KEY, limit: "200", format: "json",
});
const recent = await fetch("https://ws.audioscrobbler.com/2.0/?" + params).then(r => r.json());
if (!recent.recenttracks) throw new Error("Last.fm error: " + JSON.stringify(recent));

const tracks = [].concat(recent.recenttracks.track || []);
const hit = tracks.find(t => isSad(t.name, t.artist["#text"]));
if (!hit) { console.log("No sad song in your last 200 scrobbles; leaving sad.json as is."); process.exit(0); }

const title = hit.name;
const artist = hit.artist["#text"];
const nowPlaying = hit["@attr"]?.nowplaying === "true";

// 2. Album cover: Last.fm's image if it has one, otherwise iTunes' free search
const PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f"; // Last.fm's grey star image
let art = (hit.image || []).map(i => i["#text"]).filter(Boolean).pop() || "";
if (!art || art.includes(PLACEHOLDER)) {
  art = "";
  try {
    const it = await fetch("https://itunes.apple.com/search?" + new URLSearchParams({
      term: `${artist} ${title.split(" - ")[0]}`, entity: "song", limit: "1",
    })).then(r => r.json());
    art = (it.results?.[0]?.artworkUrl100 || "").replace("100x100", "600x600");
  } catch {}
}

const out = {
  title,
  artist,
  album: hit.album?.["#text"] || "",
  art,
  url: hit.url,
  playedAt: nowPlaying ? new Date().toISOString() : new Date(Number(hit.date.uts) * 1000).toISOString(),
};

// 3. Upload to Neocities
const form = new FormData();
form.append("sad.json", new Blob([JSON.stringify(out)], { type: "application/json" }), "sad.json");
const up = await fetch("https://neocities.org/api/upload", {
  method: "POST",
  headers: { Authorization: `Bearer ${NEOCITIES_API_KEY}` },
  body: form,
});
console.log(`Uploaded "${out.title}" by ${out.artist}:`, await up.text());
