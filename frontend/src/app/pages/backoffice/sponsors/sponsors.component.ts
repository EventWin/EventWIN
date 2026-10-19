import { Component, OnInit, ViewEncapsulation, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { EventContextService } from '../../../twin/event-context.service';
import { SponsorsStateService } from '../../../sponsors/sponsors-state.service';
import { SponsorDealPanelComponent } from './sponsor-deal-panel.component';
import { SponsorFormComponent } from './sponsor-form.component';

/** Coquille du module : en-tête, onglets, et panneaux latéraux partagés (deal, sponsor). */
@Component({
  selector: 'app-sponsors',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, SponsorDealPanelComponent, SponsorFormComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="page-head">
      <div>
        <div class="eyebrow">Financement</div>
        <h1 class="title">Sponsors</h1>
        <p class="lede">Pipeline de financement, contreparties et paiements des sponsors de votre événement.</p>
      </div>
      <div class="acts">
        <label class="sp-event-pick">
          <span>Événement</span>
          <select class="in" (change)="pick($any($event.target).value)" aria-label="Événement sponsorisé">
            <option value="" disabled [selected]="!context.current">{{ events.length ? 'Choisir un événement' : 'Aucun événement' }}</option>
            <!-- [selected] par option : la liste arrive après le rendu initial. -->
            <option *ngFor="let e of events" [value]="e.id" [selected]="e.id === context.current?.id">{{ e.name }}</option>
          </select>
        </label>
        <button type="button" class="btn btn-primary btn-sm" (click)="state.openSponsorForm()">Nouveau sponsor</button>
      </div>
    </div>

    <nav class="sp-tabs" aria-label="Sections du module sponsors">
      <a routerLink="overview" routerLinkActive="active">Vue d'ensemble</a>
      <a routerLink="pipeline" routerLinkActive="active">Pipeline</a>
      <a routerLink="directory" routerLinkActive="active">Annuaire</a>
      <a routerLink="packages" routerLinkActive="active">Packages</a>
      <a routerLink="deliverables" routerLinkActive="active">Contreparties</a>
      <a routerLink="payments" routerLinkActive="active">Paiements</a>
      <a routerLink="analysis" routerLinkActive="active">Analyse &amp; ROI</a>
    </nav>

    <router-outlet></router-outlet>
    <sp-deal-panel></sp-deal-panel>
    <sp-sponsor-form></sp-sponsor-form>
  `,
  styles: [`
    .sp-event-pick{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--tx-3)}
    .sp-event-pick .in{width:auto;min-width:240px;padding:8px 34px 8px 12px;font-size:13px}
    .sp-tabs{display:flex;gap:3px;border-bottom:1px solid var(--line);margin-bottom:20px;overflow-x:auto}
    .sp-tabs a{padding:11px 15px;font-size:13.5px;color:var(--tx-2);border-bottom:2px solid transparent;white-space:nowrap}
    .sp-tabs a:hover{color:var(--tx)}
    .sp-tabs a.active{color:var(--tx);border-bottom-color:var(--violet);font-weight:500}

    .sp-error{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;margin-bottom:16px;border-radius:14px;
      border:1px solid rgba(232,69,95,.4);background:rgba(232,69,95,.08);color:var(--risk);font-size:13.5px}
    .sp-error span{flex:1;min-width:200px}
    .sp-ok{padding:10px 14px;margin:8px 0;border-radius:12px;background:rgba(15,169,125,.12);color:var(--gain);font-size:13px}
    .sp-loading{padding:18px 4px}
    .sp-warn{padding:10px 14px;border-radius:12px;background:rgba(224,148,11,.14);color:var(--warn);font-size:13px;margin-bottom:14px}
    .sp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .sp-row .in{flex:1;min-width:160px}
    .sp-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
    .sp-toolbar .in{width:auto;min-width:150px;padding:9px 13px;font-size:13px}
    .sp-toolbar .sp-search{flex:1;min-width:200px;max-width:320px}
    .sp-field-error{color:var(--risk);font-size:12.5px;margin-top:5px}
    .sp-two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .sp-link{color:var(--violet);font-weight:500;cursor:pointer;background:none;border:0;padding:0}
    .sp-link:hover{text-decoration:underline}
    .sp-money{font-family:var(--font-ui);font-variant-numeric:tabular-nums;font-weight:600;color:var(--tx)}
    .sp-avatar{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;flex:none;overflow:hidden;
      background:var(--sub);color:var(--tx-2);font:700 11px var(--font-ui)}
    .sp-avatar img{width:100%;height:100%;object-fit:cover}
    .sp-who{display:flex;align-items:center;gap:10px}
    .sp-who small{display:block;font-size:11.5px;color:var(--tx-3)}
    .sp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:16px}
    .sp-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
    .sp-stack{display:flex;height:14px;border-radius:14px;overflow:hidden;background:var(--sub);margin:14px 0 10px}
    .sp-stack i{display:block;height:100%}
    .sp-seg-confirmed{background:var(--gain)}.sp-seg-weighted{background:var(--violet)}.sp-seg-gap{background:var(--line-2)}
    .sp-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--tx-2)}
    .sp-legend span::before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:var(--line-2)}
    .sp-legend .c::before{background:var(--gain)}.sp-legend .w::before{background:var(--violet)}
    .sp-list{display:grid}
    .sp-list-item{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);font-size:13.5px}
    .sp-list-item:last-child{border-bottom:0}
    .sp-list-item .grow{flex:1;min-width:0}
    .sp-list-item p{font-size:12.5px;color:var(--tx-2)}
    .sp-bar{height:8px;border-radius:8px;background:var(--sub);overflow:hidden}
    .sp-bar i{display:block;height:100%;border-radius:8px;background:var(--ai)}
    .sp-bar.mini{height:5px;width:100%}
    .sp-row-late{background:rgba(232,69,95,.06)}
    .sp-group td{background:var(--sub);color:var(--tx);font-weight:600}

    .sp-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);gap:12px;overflow-x:auto;padding-bottom:10px}
    .sp-col{background:var(--sub);border-radius:16px;padding:12px;min-height:220px;display:flex;flex-direction:column;gap:10px;border:1px dashed transparent}
    .sp-col.over{border-color:var(--violet);background:rgba(124,92,255,.06)}
    .sp-col-head{display:flex;flex-direction:column;gap:2px}
    .sp-col-head b{font-size:13px;color:var(--tx)}
    .sp-col-head span{font-size:12px;color:var(--tx-3)}
    .sp-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;cursor:grab;display:grid;gap:8px;box-shadow:var(--sh)}
    .sp-card:active{cursor:grabbing}
    .sp-card.dragging{opacity:.45}
    .sp-card h4{font-size:13.8px;font-weight:600}
    .sp-card-top{display:flex;gap:10px;align-items:center}
    .sp-card-meta{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--tx-2);gap:8px}
    .sp-card-meta>*{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sp-card h4{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sp-lost{margin-top:18px}

    .sp-overlay{position:fixed;inset:0;background:rgba(11,13,24,.45);z-index:80}
    .sp-drawer{position:fixed;top:0;right:0;bottom:0;width:min(520px,100%);background:var(--card);z-index:85;overflow-y:auto;
      padding:24px;box-shadow:-20px 0 60px -20px rgba(0,0,0,.4);border-left:1px solid var(--line)}
    .sp-drawer-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}
    .sp-drawer-head h3{font-size:18px;flex:1}
    .sp-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(560px,calc(100% - 28px));max-height:90vh;overflow-y:auto;
      background:var(--card);z-index:90;border-radius:20px;padding:24px;box-shadow:var(--sh);border:1px solid var(--line)}
    .sp-modal h3{font-size:17px;margin-bottom:6px}
    .sp-inner-tabs{display:flex;gap:3px;border-bottom:1px solid var(--line);margin-bottom:16px;overflow-x:auto}
    .sp-inner-tabs button{padding:9px 12px;font-size:13px;color:var(--tx-2);border-bottom:2px solid transparent;white-space:nowrap}
    .sp-inner-tabs button.active{color:var(--tx);border-bottom-color:var(--violet);font-weight:500}
    .sp-kv{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
    .sp-kv div small{display:block;font-size:12px;color:var(--tx-3)}
    .sp-kv div b{font-size:14px}
    .sp-pkg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
    .sp-pkg{display:grid;gap:10px;align-content:start}
    .sp-pkg ul{padding-left:18px;font-size:13px;color:var(--tx-2)}
    .sp-benefit-row{display:grid;grid-template-columns:1.1fr 1.6fr .7fr auto;gap:8px;margin-bottom:8px;align-items:center}
    .sp-crit{display:grid;grid-template-columns:150px 1fr 40px;gap:10px;align-items:center;font-size:12.5px;margin:7px 0}
    .sp-crit small{grid-column:1/-1;color:var(--tx-3);margin-top:-4px}
    .sp-score{font:600 20px var(--font-ui)}
    .sp-dup{border:1px solid rgba(224,148,11,.5);background:rgba(224,148,11,.08);border-radius:14px;padding:12px 14px;margin-bottom:14px;font-size:13px}
    .sp-dup ul{margin:6px 0 10px 18px}
    @media (max-width:900px){.sp-stats{grid-template-columns:1fr 1fr}.sp-cols{grid-template-columns:1fr}.sp-two{grid-template-columns:1fr}}
  `]
})
export class SponsorsComponent implements OnInit {
  protected readonly state = inject(SponsorsStateService);
  protected readonly context = inject(EventContextService);
  private readonly http = inject(HttpClient);
  protected events: { id: string; name: string; status: string; start_date: string | null }[] = [];

  ngOnInit(): void {
    // Même sélection d'événement que le reste de l'application (jumeau, budget…).
    // À défaut, le prochain événement publié est proposé d'office.
    this.http.get<typeof this.events>('/api/events/').subscribe(events => {
      this.events = events.filter(e => e.status !== 'cancelled');
      const current = this.context.current;
      if (!current || !this.events.some(e => e.id === current.id)) {
        const next = this.events.find(e => e.status === 'published') ?? this.events[0];
        if (next) this.context.select(next.id, next.name);
      }
    });
  }

  protected pick(id: string): void {
    const event = this.events.find(e => e.id === id);
    if (event) this.context.select(event.id, event.name);
  }
}
