import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onIdTokenChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

interface WebConfig {
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  projectId: string;
}

let authPromise: Promise<Auth> | null = null;

/** Firebase web config is served by the API at runtime so one image works in any env. */
export function getFirebaseAuth(): Promise<Auth> {
  authPromise ??= fetch("/config.json")
    .then((r) => {
      if (!r.ok) throw new Error(`config.json ${r.status}`);
      return r.json() as Promise<WebConfig>;
    })
    .then((cfg) =>
      getAuth(
        initializeApp({
          apiKey: cfg.firebaseApiKey,
          authDomain: cfg.firebaseAuthDomain,
          projectId: cfg.projectId,
        }),
      ),
    );
  return authPromise;
}

export async function signIn(): Promise<void> {
  await signInWithPopup(await getFirebaseAuth(), new GoogleAuthProvider());
}

export async function signOutUser(): Promise<void> {
  await signOut(await getFirebaseAuth());
}

export async function watchUser(cb: (user: User | null) => void): Promise<() => void> {
  return onIdTokenChanged(await getFirebaseAuth(), cb);
}

/** The signed-in user's Firebase ID token (refreshed by the SDK when near expiry), or null. */
export async function getIdToken(): Promise<string | null> {
  const user = (await getFirebaseAuth()).currentUser;
  return user ? user.getIdToken() : null;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getIdToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}
