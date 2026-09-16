import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <main class="app-shell">
      <header class="topbar">
        <h1>EventTwin</h1>
        <span class="badge">Architecture ready</span>
      </header>

      <section class="panel">
        <h2>Project foundation</h2>
        <ul>
          <li>Angular frontend scaffold created</li>
          <li>Django API project initialized</li>
          <li>PostgreSQL configuration prepared</li>
          <li>Docs and next-step plan added</li>
        </ul>
      </section>
    </main>
  `,
  styles: [
    `
      .app-shell {
        max-width: 900px;
        margin: 48px auto;
        padding: 24px;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
      }

      h1 {
        margin: 0;
      }

      .badge {
        background: #dfeeff;
        color: #123d72;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 0.85rem;
        font-weight: 700;
      }

      .panel {
        background: white;
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
      }

      ul {
        margin: 12px 0 0 20px;
        line-height: 1.8;
      }
    `
  ]
})
export class AppComponent {}
