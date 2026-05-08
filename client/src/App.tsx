import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { SyncProvider } from "./sync/SyncProvider";
import { LoginScreen } from "./components/LoginScreen";
import { ListsScreen } from "./components/ListsScreen";
import { ListScreen } from "./components/ListScreen";
import { AdminScreen } from "./components/AdminScreen";
import { ShareScreen } from "./components/ShareScreen";
import { ToastProvider } from "./components/Toast";
import { matchRoute, useLocation } from "./router";

function Routed() {
  const path = useLocation();
  const route = matchRoute(path);

  if (route.name === "list") return <ListScreen listId={route.id} />;
  if (route.name === "admin") return <AdminScreen />;
  return <ListsScreen />;
}

function Authenticated() {
  const { logout } = useAuth();
  return (
    <SyncProvider enabled onAuthError={() => void logout()}>
      <ToastProvider>
        <div className="app">
          <Routed />
        </div>
      </ToastProvider>
    </SyncProvider>
  );
}

function UserGate() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Authenticated /> : <LoginScreen />;
}

export default function App() {
  const path = useLocation();
  const route = matchRoute(path);

  // Guest share links live entirely outside the user-auth tree — they
  // get their own provider and Dexie reset behaviour.
  if (route.name === "share") {
    return <ShareScreen shareToken={route.token} />;
  }

  return (
    <AuthProvider>
      <UserGate />
    </AuthProvider>
  );
}
