import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { apiFetch, signIn, signOutUser, watchUser } from "@/lib/auth";

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

  const forbidden = me.data?.status === 403;
  return (
    <Shell
      action={
        <Button variant="outline" size="sm" onClick={() => void signOutUser()}>
          Sign out
        </Button>
      }
    >
      {me.isLoading && <p className="text-muted-foreground">Checking access…</p>}
      {forbidden && (
        <p className="text-destructive">{user.email} is not allowed to use this control plane.</p>
      )}
      {me.data?.me && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Needs you</h2>
          <p className="text-muted-foreground">Nothing yet. Signed in as {me.data.me.email}.</p>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-8 flex items-center justify-between border-b border-border pb-4">
        <h1 className="text-xl font-semibold">andy-intelligence</h1>
        {action}
      </header>
      <main>{children}</main>
    </div>
  );
}
