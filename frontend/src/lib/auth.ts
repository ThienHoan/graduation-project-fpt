export type AppRole = "customer" | "staff" | "manager_owner" | "admin";

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: AppRole;
  isActive: boolean;
  fullName: string | null;
  phone: string | null;
};

export type AuthSession = {
  accessToken: string;
  user: AuthenticatedUser;
  persist?: boolean;
};

export const AUTH_SESSION_STORAGE_KEY = "co_phuc_auth_session";

const LEGACY_ACCESS_TOKEN_KEY = "access_token";
const LEGACY_ROLE_KEY = "user_role";

const dashboardPathByRole: Record<AppRole, string> = {
  customer: "/dashboard/customer",
  staff: "/dashboard/staff",
  manager_owner: "/dashboard/manager",
  admin: "/dashboard/admin",
};

const roleLabelByRole: Record<AppRole, string> = {
  customer: "Customer",
  staff: "Staff",
  manager_owner: "Manager/Owner",
  admin: "Admin",
};

export function toAuthenticatedUser(
  user: Pick<AuthenticatedUser, "id" | "email" | "role"> & Partial<Omit<AuthenticatedUser, "id" | "email" | "role">>,
): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.isActive ?? true,
    fullName: user.fullName ?? null,
    phone: user.phone ?? null,
  };
}

export function resolveDashboardPath(role: AppRole) {
  return dashboardPathByRole[role];
}

export function getRoleLabel(role: AppRole) {
  return roleLabelByRole[role];
}

export function normalizeNullableText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRole(value: unknown): value is AppRole {
  return value === "customer" || value === "staff" || value === "manager_owner" || value === "admin";
}

type StoredSessionCandidate = {
  accessToken?: unknown;
  user?: {
    id?: unknown;
    email?: unknown;
    role?: unknown;
    isActive?: unknown;
    fullName?: unknown;
    phone?: unknown;
  };
  persist?: unknown;
};

function normalizeStoredSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as StoredSessionCandidate;
  const user = candidate.user;
  if (
    typeof candidate.accessToken !== "string" ||
    !user ||
    typeof user !== "object" ||
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    !isRole(user.role)
  ) {
    return null;
  }

  return {
    accessToken: candidate.accessToken,
    user: toAuthenticatedUser({
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: typeof user.isActive === "boolean" ? user.isActive : undefined,
      fullName: typeof user.fullName === "string" ? user.fullName : undefined,
      phone: typeof user.phone === "string" ? user.phone : undefined,
    }),
    persist: typeof candidate.persist === "boolean" ? candidate.persist : true,
  };
}

function readSessionFromStorage(storage?: Storage) {
  if (!storage) {
    return null;
  }
  const rawValue = storage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return normalizeStoredSession(JSON.parse(rawValue) as unknown);
  } catch {
    return null;
  }
}

function readLegacySession(storage?: Storage): AuthSession | null {
  if (!storage) {
    return null;
  }
  const accessToken = storage.getItem(LEGACY_ACCESS_TOKEN_KEY);
  const role = storage.getItem(LEGACY_ROLE_KEY);

  return accessToken && isRole(role)
    ? {
        accessToken,
        user: toAuthenticatedUser({ id: "", email: "", role }),
        persist: true,
      }
    : null;
}

function clearAuthStorage(storage: Storage) {
  storage.removeItem(AUTH_SESSION_STORAGE_KEY);
  storage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  storage.removeItem(LEGACY_ROLE_KEY);
}

export function readStoredSession(): AuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  return readSessionFromStorage(window.localStorage) ?? readSessionFromStorage(window.sessionStorage) ?? readLegacySession(window.localStorage);
}

export function readStoredAccessToken() {
  return readStoredSession()?.accessToken ?? null;
}

export function storeAuthSession(session: AuthSession) {
  if (typeof window === "undefined") {
    return;
  }

  const persist = session.persist ?? true;
  const normalizedSession = {
    accessToken: session.accessToken,
    user: toAuthenticatedUser(session.user),
    persist,
  };

  clearAuthStorage(window.localStorage);
  clearAuthStorage(window.sessionStorage);

  const targetStorage = persist ? window.localStorage : window.sessionStorage;
  targetStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(normalizedSession));

  if (persist) {
    targetStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, normalizedSession.accessToken);
    targetStorage.setItem(LEGACY_ROLE_KEY, normalizedSession.user.role);
  }
}

export function clearAuthSession() {
  if (typeof window === "undefined") {
    return;
  }

  clearAuthStorage(window.localStorage);
  clearAuthStorage(window.sessionStorage);
}