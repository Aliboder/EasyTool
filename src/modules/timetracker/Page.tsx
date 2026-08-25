import { useModuleConfig } from "@/hooks/useModuleConfig";
import { TIMETRACKER_DEFAULTS } from "./config";
import { TimetrackerView } from "./TimetrackerView";

export function TimetrackerPage({ active = true }: { active?: boolean }) {
  const { cfg, update } = useModuleConfig("timetracker", TIMETRACKER_DEFAULTS);

  return <TimetrackerView cfg={cfg} onUpdate={update} popup={false} active={active} />;
}
