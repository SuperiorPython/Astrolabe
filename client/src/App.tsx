import { useState } from "react";
import { ApodSection } from "./components/ApodSection";
import { ExoplanetsSection } from "./components/ExoplanetsSection";
import { SpaceWeatherSection } from "./components/SpaceWeatherSection";
import { IssSection } from "./components/IssSection";
import { NeoWsSection } from "./components/NeoWsSection";
import { HomeGlobe } from "./components/HomeGlobe";
import { Logo } from "./components/Logo";
import { TabHeader } from "./components/TabHeader";
import { FeatureUnavailable } from "./components/FeatureUnavailable";
import { FEEDS, type FeedKey } from "./lib/feeds";
import { useFeedHealth } from "./lib/useFeedHealth";

function feedLabel(key: FeedKey): string {
  return FEEDS.find((f) => f.key === key)?.navLabel ?? key;
}

function App() {
  // null = the globe landing screen; otherwise the active tab.
  const [activeTab, setActiveTab] = useState<FeedKey | null>(null);
  const feedHealth = useFeedHealth();

  // The landing screen is the globe filling the whole viewport, with the
  // title floating over it — it deliberately skips the centered, padded
  // page layout the tabs use below.
  if (activeTab === null) {
    return (
      <div className="home-screen">
        <HomeGlobe onSelect={setActiveTab} status={feedHealth} />
        <header className="home-title">
          <h1 className="brand">
            <Logo size={44} />
            <span>Astrolabe</span>
          </h1>
          <p className="muted">A live look at near-Earth space, built on NASA's public APIs.</p>
        </header>
        <p className="home-hint muted">Drag to rotate · select a label to open it</p>
      </div>
    );
  }

  let content: JSX.Element;
  if (feedHealth[activeTab] === "down") {
    content = <FeatureUnavailable label={feedLabel(activeTab)} />;
  } else {
    switch (activeTab) {
      case "apod":
        content = <ApodSection />;
        break;
      case "exoplanets":
        content = <ExoplanetsSection />;
        break;
      case "space-weather":
        content = <SpaceWeatherSection />;
        break;
      case "iss":
        content = <IssSection />;
        break;
      case "neows":
        content = <NeoWsSection />;
        break;
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="brand">
          <Logo size={36} />
          <span>Astrolabe</span>
        </h1>
        <p className="muted">A live look at near-Earth space, built on NASA's public APIs.</p>
      </header>

      <TabHeader active={activeTab} onHome={() => setActiveTab(null)} />

      <main>{content}</main>
    </div>
  );
}

export default App;