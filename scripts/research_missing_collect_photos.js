#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { plan } = require("./enrich_collect_paris_photos");
const {
  viewAlongStreet,
  axisDifference,
} = require("./lib/collect-street-view");
async function research(output) {
  fs.mkdirSync(output, { recursive: true });
  const jobs = plan({ allStreets: true });
  const results = new Array(jobs.length);
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const index = cursor++,
        job = jobs[index];
      const report = {
        key: job.key,
        name: job.name,
        target: job.target,
        checkedAt: new Date().toISOString(),
        candidates: [],
      };
      try {
        const points = job.locations.length ? job.locations : [job.target];
        const bbox = [
          Math.min(...points.map((p) => p[0])) - 0.00025,
          Math.min(...points.map((p) => p[1])) - 0.0002,
          Math.max(...points.map((p) => p[0])) + 0.00025,
          Math.max(...points.map((p) => p[1])) + 0.0002,
        ];
        const url =
          "https://api.panoramax.xyz/api/search?limit=500&bbox=" +
          bbox.join(",");
        report.search = url;
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        report.pictures = data.features?.length || 0;
        report.truncated = Boolean(data.links?.some((l) => l.rel === "next"));
        for (const item of data.features || []) {
          const coordinate = item.geometry?.coordinates,
            axis = coordinate && viewAlongStreet(coordinate, job.features);
          const azimuth = Number(item.properties?.["view:azimuth"]);
          const license =
            item.links?.find((l) => l.rel === "license")?.title || "";
          if (
            !axis ||
            axis.distanceMeters > 18 ||
            !Number.isFinite(azimuth) ||
            axisDifference(azimuth, axis.heading) > 45 ||
            !license.includes("CC-BY-SA-4.0") ||
            item.properties?.["pers:interior_orientation"] === "equirectangular"
          )
            continue;
          const producer = item.providers?.find((p) =>
            p.roles?.includes("producer"),
          )?.name;
          if (
            !producer ||
            String(item.properties.datetime).slice(0, 4) < "2016"
          )
            continue;
          report.candidates.push({
            id: item.id,
            coordinate,
            azimuth,
            distance: axis.distanceMeters,
            heading: axis.heading,
            producer,
            license: "CC-BY-SA-4.0",
            datetime: item.properties.datetime,
            source: item.links.find((l) => l.rel === "self")?.href,
            sd: item.assets?.sd?.href,
            thumb: item.assets?.thumb?.href,
          });
        }
        report.candidates.sort((a, b) => a.distance - b.distance);
        report.candidates = report.candidates.slice(0, 3);
        report.status = report.candidates.length
          ? "visual-review-required"
          : "no-reliable-axis-candidate";
      } catch (error) {
        report.status = "search-failed";
        report.error = error.message;
      }
      results[index] = report;
      fs.writeFileSync(
        path.join(output, "research.json"),
        JSON.stringify(results.filter(Boolean), null, 2) + "\n",
      );
      console.log(`${index + 1}/${jobs.length} ${job.name}: ${report.status}`);
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
}
if (require.main === module)
  research(path.resolve(process.argv[2] || "/tmp/parici-photo-research")).catch(
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
module.exports = { research };
