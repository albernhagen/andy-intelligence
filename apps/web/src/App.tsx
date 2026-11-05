import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { User } from "firebase/auth";
import { HeaderEndContext } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ApiContext, createApi } from "@/lib/api";
import { apiFetch, getIdToken, signIn, signOutUser, watchUser } from "@/lib/auth";
import { makeRouter } from "./router";

const api = createApi({ baseUrl: window.location.origin, getToken: getIdToken });
const router = makeRouter();

type Me = { email: string; uid: string };

function useMe(user: User | null) {
  return useQuery({
    queryKey: ["me", user?.uid],
    enabled: !!user,
    retry: false,
    queryFn: async (): Promise<{ status: number; me?: Me }> => {
      const res = await apiFetch("/api/me");
      return res.ok ? { status: res.status, me: (await res.json()) as Me } : { status: res.status };
    },
  });
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const me = useMe(user ?? null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    watchUser(setUser)
      .then((u) => (unsub = u))
      .catch((e: unknown) => setError(String(e)));
    return () => unsub?.();
  }, []);

  if (error)
    return (
      <Shell>
        <p className="text-destructive">Failed to load: {error}</p>
      </Shell>
    );
  if (user === undefined)
    return (
      <Shell>
        <p className="text-muted-foreground">Loading…</p>
      </Shell>
    );

  if (!user) {
    return (
      <Shell>
        <Button onClick={() => signIn().catch((e: unknown) => setError(String(e)))}>
          Sign in with Google
        </Button>
      </Shell>
    );
  }

  const signOut = (
    <Button variant="ghost" size="sm" onClick={() => void signOutUser()}>
      Sign out
    </Button>
  );
  if (me.data?.me)
    return (
      <ApiContext.Provider value={api}>
        <HeaderEndContext.Provider value={signOut}>
          <RouterProvider router={router} />
        </HeaderEndContext.Provider>
      </ApiContext.Provider>
    );
  return (
    <Shell action={signOut}>
      {me.isLoading && <p className="text-muted-foreground">Checking access…</p>}
      {me.data?.status === 403 && (
        <p className="text-destructive">{user.email} is not allowed to use this control plane.</p>
      )}
    </Shell>
  );
}

/** Before sign-in and access checks; once in, the router's AppShell takes over. */
function Shell({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="flex h-12 items-center justify-between border-b border-border px-4 sm:px-6">
        <h1 className="font-semibold">andy-intelligence</h1>
        {action}
      </header>
      <main className="px-4 py-4 sm:px-6">{children}</main>
    </div>
  );
}
