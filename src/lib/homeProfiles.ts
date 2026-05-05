import { getUserCache, setUserCache } from "@/lib/userCache";

export type HomeProfile = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
};

export type HomeProfilesState = {
  version: 1;
  selectedProfileId: string;
  profiles: HomeProfile[];
  updatedAt: number;
};

const LOCAL_KEY = "acervos_home_profiles_v1";
const USER_CACHE_KEY = "home_profiles_v1";
const PROFILE_COLORS = ["#f97316", "#ef4444", "#8b5cf6", "#22c55e", "#06b6d4", "#f59e0b"];

function fallbackState(): HomeProfilesState {
  const profile: HomeProfile = {
    id: "profile_main",
    name: "Principal",
    color: PROFILE_COLORS[0],
    createdAt: Date.now(),
  };
  return {
    version: 1,
    selectedProfileId: profile.id,
    profiles: [profile],
    updatedAt: Date.now(),
  };
}

export async function loadHomeProfiles(): Promise<HomeProfilesState> {
  let local: HomeProfilesState | null = null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) local = JSON.parse(raw) as HomeProfilesState;
  } catch {
    local = null;
  }
  const user = await getUserCache<HomeProfilesState>(USER_CACHE_KEY);
  const base = user && user.version === 1 ? user : local;
  if (!base || base.version !== 1 || !Array.isArray(base.profiles) || base.profiles.length === 0) {
    return fallbackState();
  }
  const selectedExists = base.profiles.some((p) => p.id === base.selectedProfileId);
  return {
    ...base,
    selectedProfileId: selectedExists ? base.selectedProfileId : base.profiles[0].id,
  };
}

export async function persistHomeProfiles(state: HomeProfilesState): Promise<void> {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {
    void 0;
  }
  await setUserCache<HomeProfilesState>(USER_CACHE_KEY, state);
}

export function addProfile(state: HomeProfilesState, name: string): HomeProfilesState {
  const normalized = name.trim().slice(0, 16);
  if (!normalized) return state;
  if (state.profiles.length >= 6) return state;
  const nextId = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const nextProfile: HomeProfile = {
    id: nextId,
    name: normalized,
    color: PROFILE_COLORS[state.profiles.length % PROFILE_COLORS.length],
    createdAt: Date.now(),
  };
  return {
    ...state,
    selectedProfileId: nextProfile.id,
    profiles: [...state.profiles, nextProfile],
    updatedAt: Date.now(),
  };
}

export function selectProfile(state: HomeProfilesState, profileId: string): HomeProfilesState {
  if (!state.profiles.some((p) => p.id === profileId)) return state;
  return {
    ...state,
    selectedProfileId: profileId,
    updatedAt: Date.now(),
  };
}
