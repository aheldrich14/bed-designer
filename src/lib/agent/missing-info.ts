import { frameBounds, effectivePoints, formatFtIn, regionNames } from "../geometry";
import type { Bed, MissingInfoItem } from "../types";

/**
 * The missing-info checklist for an agent draft. Each item says why it
 * matters. Items the bed record already answers are marked answered; free-text
 * answers (like style preferences) carry over from the previous checklist.
 */
export function buildChecklist(bed: Bed, previous: MissingInfoItem[] = []): MissingInfoItem[] {
  const prev = new Map(previous.map((i) => [i.key, i]));
  const c = bed.conditions;
  const hasOutline = bed.outline.points.length >= 3;
  const items: MissingInfoItem[] = [];
  const add = (key: string, question: string, why: string, answered: string | null, required = true) => {
    const p = prev.get(key);
    if (answered != null) items.push({ key, question, why, status: "answered", answer: answered });
    else if (p && p.status !== "missing") items.push({ ...p, question, why });
    else items.push({ key, question, why, status: required ? "missing" : "skipped" });
  };

  add(
    "outline",
    "Trace the bed outline on the aerial (or draw it in the editor)",
    "Sets the area, the plant counts and where the back and front tiers go.",
    hasOutline ? `${bed.outline.points.length} points traced` : null,
  );
  if (hasOutline) {
    const fb = frameBounds(effectivePoints(bed.outline), c.orientation);
    const depth = fb.maxD - fb.minD;
    const [leftEnd] = regionNames(c.orientation, 3);
    add(
      "depth",
      `Bed depth at the ${leftEnd}`,
      "Sets how many height tiers fit: under 3 ft holds one tier, 6 ft or more holds three.",
      depth > 0 ? `about ${formatFtIn(depth)} (from the outline)` : null,
    );
  }
  add(
    "orientation",
    "Which way does the bed face (where do you stand to look at it)?",
    "Decides which edge is the back, so tall plants go behind short ones.",
    c.orientation ? `faces ${c.orientation}` : null,
  );
  add(
    "sunHours",
    "Hours of direct sun in midsummer",
    "The biggest filter on which plants will thrive: 6+ hours is full sun, 3 to 6 part shade.",
    c.sunHours != null ? `${c.sunHours} h` : null,
  );
  add(
    "moisture",
    "Does the soil stay dry, average or wet after rain?",
    "Rules out plants that rot in wet clay or sulk in dry sand.",
    c.moisture,
  );
  add(
    "soil",
    "Soil type: sand, loam or clay?",
    "Some plants (wild lupine, prairie smoke) need sharp drainage.",
    c.soil,
    false,
  );
  add(
    "existing",
    "Existing plants to keep or remove",
    "Keepers stay in the plan and drifts are drawn around them.",
    bed.existing.length ? `${bed.existing.length} marked` : null,
    false,
  );
  add(
    "style",
    "Any must-have plants, colors or things to avoid?",
    "Lets the draft lean toward your palette instead of a generic mix.",
    null,
    false,
  );
  add(
    "streetPhoto",
    "A street-level photo of the bed",
    "Not needed for the plan; the renders use it as the viewpoint.",
    bed.photos.some((p) => p.isStreetView) ? "uploaded" : null,
    false,
  );
  return items;
}

export function missingRequired(items: MissingInfoItem[]): MissingInfoItem[] {
  return items.filter((i) => i.status === "missing");
}
