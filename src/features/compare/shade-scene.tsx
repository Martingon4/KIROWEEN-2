import solarData from "../../../data/sites/zocalo-puebla/solar-scenarios.json";
import type { Locale } from "@/lib/i18n/locales";
import type { ComparePageResult } from "@/lib/schemas/compare";
import { shadeSceneSchema } from "@/lib/schemas/shade-scene";
import { createClient } from "@/lib/supabase/server";
import { ShadeWorkbench } from "./shade-workbench";
import type es from "@/messages/es.json";

async function loadShadeScene(ref: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_shade_scene", { p_ref: ref });
  if (error) return null;
  const parsed = shadeSceneSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function ShadeSimulation({
  result,
  locale,
  side,
  sideName,
  copy,
}: {
  result: ComparePageResult;
  locale: Locale;
  side: "left" | "right";
  sideName: { left: string; right: string };
  copy: typeof es.compare.shadeScene;
}) {
  const snapshot = result[side];
  const scene = await loadShadeScene(snapshot.ref);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

  return (
    <section id="shade-3d" aria-labelledby="shade-scene-title">
      <h2 id="shade-scene-title">{copy.title}</h2>
      <p className="field-help">{copy.description}</p>
      <form
        className="shade-scene-controls"
        method="get"
        action={`/${locale}/compare#shade-3d`}
      >
        <input type="hidden" name="left" value={result.left.ref} />
        <input type="hidden" name="right" value={result.right.ref} />
        <label>
          {copy.revision}
          <select name="shade" defaultValue={side}>
            <option value="left">A · {sideName.left}</option>
            <option value="right">B · {sideName.right}</option>
          </select>
        </label>
        <label>
          {copy.time}
          <select name="scenario" defaultValue={result.scenario.slug}>
            {solarData.scenarios.map((scenario) => (
              <option key={scenario.slug} value={scenario.slug}>
                {scenario.localDatetime.slice(11, 16)}
              </option>
            ))}
          </select>
        </label>
        <button className="button button-primary" type="submit">
          {copy.apply}
        </button>
      </form>
      {scene ? (
        <ShadeWorkbench
          key={snapshot.ref}
          scene={scene}
          solar={result.scenario}
          copy={copy}
          caption={`${sideName[side]} · ${result.scenario.localDatetime.slice(11, 16)}`}
          savedArea={`${copy.area} ${number.format(snapshot.analysis.shade.m2)} m² · ${number.format(snapshot.analysis.shade.pct)} %`}
        />
      ) : (
        <p className="field-help">{copy.unavailable}</p>
      )}
    </section>
  );
}
