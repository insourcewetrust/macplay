import { useEffect } from "react";
import { useStore } from "./lib/store";
import { useRoute } from "./ui/router";
import { Icon } from "./ui/Icon";
import { Home } from "./screens/Home";
import { Onboarding } from "./screens/Onboarding";
import { NewTrip } from "./screens/NewTrip";
import { TripView } from "./screens/TripView";
import { Guide, ArticleView } from "./screens/Guide";
import { Settings } from "./screens/Settings";

export function App() {
  const state = useStore();
  const route = useRoute();

  useEffect(() => {
    const t = state.settings.theme;
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }, [state.settings.theme]);

  if (!state.profile.onboarded) {
    return (
      <div className="app no-tabs">
        <Onboarding />
      </div>
    );
  }

  const [head, id] = route;
  let screen: JSX.Element;
  let tabs = true;
  let tab: "trips" | "guide" | "me" = "trips";
  if (head === "new") {
    screen = <NewTrip key="new" />;
    tabs = false;
  } else if (head === "edit" && id) {
    screen = <NewTrip key={"edit" + id} editId={id} />;
    tabs = false;
  } else if (head === "trip" && id) screen = <TripView key={id} id={id} />;
  else if (head === "guide" && id) {
    screen = <ArticleView key={id} id={id} />;
    tab = "guide";
  } else if (head === "guide") {
    screen = <Guide />;
    tab = "guide";
  } else if (head === "me") {
    screen = <Settings />;
    tab = "me";
  } else screen = <Home />;

  return (
    <div className={`app${tabs ? "" : " no-tabs"}`}>
      {screen}
      {tabs && (
        <nav className="tabbar" aria-label="Navigation principale">
          <a href="#/" aria-current={tab === "trips" ? "page" : undefined}>
            <Icon name="plane" size={19} />
            Voyages
          </a>
          <a href="#/guide" aria-current={tab === "guide" ? "page" : undefined}>
            <Icon name="book" size={19} />
            Guide
          </a>
          <a href="#/me" aria-current={tab === "me" ? "page" : undefined}>
            <Icon name="user" size={19} />
            Profil
          </a>
        </nav>
      )}
    </div>
  );
}
