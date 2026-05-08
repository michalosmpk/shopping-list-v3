import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { SyncProvider } from "./sync/SyncProvider";
import { LoginScreen } from "./components/LoginScreen";
import { ListsScreen } from "./components/ListsScreen";
import { ListScreen } from "./components/ListScreen";
import { SyncBar } from "./components/SyncBar";
import { matchRoute, useLocation } from "./router";

function Routed() {
  const path = useLocation();
  const route = matchRoute(path);

  if (route.name === "list") {
    return <ListScreen listId={route.id} />;
  }
  return <ListsScreen />;
}

function Authenticated() {
  const { logout } = useAuth();
  return (
    <SyncProvider enabled onAuthError={logout}>
      <div className="app">
        <SyncBar />
        <Routed />
      </div>
    </SyncProvider>
  );
}

function Gate() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Authenticated /> : <LoginScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
