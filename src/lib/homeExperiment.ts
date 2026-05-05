import { getUserCache, setUserCache } from "@/lib/userCache";

export type HomeExperimentVariant = "control" | "hero_personalized_first";

export type HomeExperimentState = {
  version: 1;
  variant: HomeExperimentVariant;
  assignedAt: number;
  exposureCount: number;
  clickCount: number;
  updatedAt: number;
};

const LOCAL_KEY = "acervos_home_experiment_v1";
const USER_CACHE_KEY = "home_experiment_v1";

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function buildInitial(seed: string): HomeExperimentState {
  const h = hashSeed(seed || `anon-${Date.now()}`);
  const variant: HomeExperimentVariant = h % 2 === 0 ? "control" : "hero_personalized_first";
  return {
    version: 1,
    variant,
    assignedAt: Date.now(),
    exposureCount: 0,
    clickCount: 0,
    updatedAt: Date.now(),
  };
}

export async function loadHomeExperiment(seed: string): Promise<HomeExperimentState> {
  let local: HomeExperimentState | null = null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) local = JSON.parse(raw) as HomeExperimentState;
  } catch {
    local = null;
  }
  const user = await getUserCache<HomeExperimentState>(USER_CACHE_KEY);
  const fromStorage = user && user.version === 1 ? user : local;
  if (!fromStorage || fromStorage.version !== 1) return buildInitial(seed);
  return fromStorage;
}

export async function persistHomeExperiment(state: HomeExperimentState): Promise<void> {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {
    void 0;
  }
  await setUserCache<HomeExperimentState>(USER_CACHE_KEY, state);
}

export function registerHomeExposure(state: HomeExperimentState): HomeExperimentState {
  return {
    ...state,
    exposureCount: state.exposureCount + 1,
    updatedAt: Date.now(),
  };
}

export function registerHomeExperimentClick(state: HomeExperimentState): HomeExperimentState {
  return {
    ...state,
    clickCount: state.clickCount + 1,
    updatedAt: Date.now(),
  };
}
