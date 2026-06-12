import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { OBJECTS, recordTitle } from "./objects";

export interface LookupOption {
  value: string;
  label: string;
}

// Module-level cache of id -> label per object, shared across components.
const cache: Record<string, LookupOption[]> = {};
const pending: Record<string, Promise<LookupOption[]>> = {};

export async function fetchLookupOptions(object: string): Promise<LookupOption[]> {
  if (cache[object]) return cache[object];
  if (object in pending) return pending[object];

  const def = OBJECTS[object];
  if (!def) return [];

  const cols = ["id", ...def.titleFields.filter((f) => f !== "id")].join(",");
  const promise = (async () => {
    const { data } = await supabase
      .from(object)
      .select(cols)
      .order("updated_at", { ascending: false })
      .limit(1000);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const options = rows.map((r) => ({
      value: String(r.id),
      label: recordTitle(def, r),
    }));
    cache[object] = options;
    delete pending[object];
    return options;
  })();
  pending[object] = promise;
  return promise;
}

export function invalidateLookup(object: string) {
  delete cache[object];
}

export function useLookupOptions(object: string | undefined): LookupOption[] {
  const [options, setOptions] = useState<LookupOption[]>(
    object && cache[object] ? cache[object] : [],
  );
  useEffect(() => {
    if (!object) return;
    let mounted = true;
    fetchLookupOptions(object).then((o) => {
      if (mounted) setOptions(o);
    });
    return () => {
      mounted = false;
    };
  }, [object]);
  return options;
}

// Map variant for fast id -> label resolution in tables
export function useLookupMaps(objects: string[]): Record<string, Record<string, string>> {
  const [maps, setMaps] = useState<Record<string, Record<string, string>>>({});
  const key = objects.sort().join(",");
  useEffect(() => {
    let mounted = true;
    const targets = key ? key.split(",") : [];
    Promise.all(targets.map((o) => fetchLookupOptions(o))).then((all) => {
      if (!mounted) return;
      const m: Record<string, Record<string, string>> = {};
      targets.forEach((o, i) => {
        m[o] = Object.fromEntries(all[i].map((opt) => [opt.value, opt.label]));
      });
      setMaps(m);
    });
    return () => {
      mounted = false;
    };
  }, [key]);
  return maps;
}
