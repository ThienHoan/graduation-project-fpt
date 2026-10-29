import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardPage from "./page";
import { useAuth } from "@/components/auth/auth-provider";
import type { AuthenticatedUser, AuthSession } from "@/lib/auth";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: vi.fn(),
}));

// Helper to build a mock useAuth return value
function mockAuth(
  status: "loading" | "unauthenticated" | "authenticated",
  user: AuthenticatedUser | null = null,
  session: AuthSession | null = null,
) {
  vi.mocked(useAuth).mockReturnValue({
    status,
    session,
    user,
    signIn: vi.fn(),
    signOut: vi.fn(),
    replaceUser: vi.fn(),
    refreshUser: vi.fn(),
  });
}

const makeUser = (role: AuthenticatedUser["role"]): AuthenticatedUser => ({
  id: "u-1",
  email: `${role}@example.com`,
  fullName: role,
  role,
  isActive: true,
  phone: null,
});

const makeSession = (user: AuthenticatedUser): AuthSession => ({
  accessToken: "tok",
  user,
});

describe("DashboardPage (Role-based redirector)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading indicator while checking auth session", () => {
    mockAuth("loading");

    render(<DashboardPage />);

    expect(screen.getByText("Checking your account...")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated user to /login?next=%2Fdashboard", () => {
    mockAuth("unauthenticated");

    render(<DashboardPage />);

    expect(mockReplace).toHaveBeenCalledWith("/login?next=%2Fdashboard");
  });

  it("redirects customer to /dashboard/customer", () => {
    const user = makeUser("customer");
    mockAuth("authenticated", user, makeSession(user));

    render(<DashboardPage />);

    expect(mockReplace).toHaveBeenCalledWith("/dashboard/customer");
  });

  it("redirects staff to /dashboard/staff", () => {
    const user = makeUser("staff");
    mockAuth("authenticated", user, makeSession(user));

    render(<DashboardPage />);

    expect(mockReplace).toHaveBeenCalledWith("/dashboard/staff");
  });

  it("redirects manager_owner to /dashboard/manager", () => {
    const user = makeUser("manager_owner");
    mockAuth("authenticated", user, makeSession(user));

    render(<DashboardPage />);

    expect(mockReplace).toHaveBeenCalledWith("/dashboard/manager");
  });

  it("redirects admin to /dashboard/admin", () => {
    const user = makeUser("admin");
    mockAuth("authenticated", user, makeSession(user));

    render(<DashboardPage />);

    expect(mockReplace).toHaveBeenCalledWith("/dashboard/admin");
  });
});
