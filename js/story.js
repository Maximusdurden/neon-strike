// Population system — NPCs trickle in slowly over time.
// No waves. The map population grows steadily, and the infection spreads
// among them. Major population milestones are called out on the banner.

import { CONFIG } from './config.js?v=20261002c';

export class Story {
  constructor(game) {
    this.game = game;
    this.bannerTimer = 0;
    this.bannerText = '';
    this.bannerSub = '';
    // Milestone tracking for population callouts.
    this.lastMilestone = 0;
    this.milestoneStep = 10; // call out every 10 NPCs
    this._calledInfection = false;
  }

  start() {
    this.lastMilestone = 0;
    this._calledInfection = false;
      this._showBanner('BLACKWOOD RIDGE', 'Deep cover. The Weave is here. Blend in and find The Vector.');
  }

  // Called when the player kills a bot.
  onKill() {
    // No wave completion logic — population just keeps flowing.
  }

  // Called each frame to check for population milestones.
  update(dt) {
    if (this.bannerTimer > 0) this.bannerTimer -= dt;

    const alive = this.game.bots.aliveCount();
    const infected = this.game.bots.infectedCount();
    const milestone = Math.floor(alive / this.milestoneStep) * this.milestoneStep;

    if (milestone > this.lastMilestone && alive >= this.milestoneStep) {
      this.lastMilestone = milestone;
          this._showBanner(`${milestone} RESIDENTS ON THE GRID`, 'The neighborhood is filling up. Stay sharp.');
    }

    // Call out the first infection when it appears.
    if (infected > 0 && !this._calledInfection) {
      this._calledInfection = true;
          this._showBanner('THE VECTOR IS HERE', 'One of them is Threaded. Find it before it spreads.');
    }
  }

  _showBanner(title, sub) {
    this.bannerText = title;
    this.bannerSub = sub;
    this.bannerTimer = 4.0;
  }

  getBanner() {
    if (this.bannerTimer <= 0) return null;
    return { title: this.bannerText, sub: this.bannerSub };
  }
}
