import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { SponsorsDataService } from '../../../sponsors/sponsors-data.service';
import {
  DELIVERABLE_STATUS_LABELS, DELIVERABLE_TYPE_LABELS, PAYMENT_STATUS_LABELS, PortalData, money
} from '../../../sponsors/sponsors.models';

/** Portail public d'un sponsor : accès par lien signé, sans compte. N'envoie aucun en-tête organisateur. */
@Component({
  selector: 'app-sponsor-portal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="portal">
      @if (state === 'loading') { <p class="muted">Chargement de votre espace…</p> }
      @if (state === 'invalid') {
        <section class="portal-card" role="alert"><h1>Lien non valide</h1>
          <p>Ce lien n'est plus valide. Contactez votre organisateur pour en recevoir un nouveau.</p></section>
      }
      @if (state === 'network') {
        <section class="portal-card" role="alert"><h1>Connexion impossible</h1>
          <p>Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.</p>
          <button type="button" class="btn" (click)="load()">Réessayer</button></section>
      }
      @if (state === 'ready' && portal) {
        <header class="portal-head">
          <p class="eyebrow">Espace sponsor</p>
          <h1>{{ portal.event_name }}</h1>
          <p>{{ portal.sponsor_name }}@if (portal.package_name) { · Package {{ portal.package_name }} }</p>
          @if (portal.event_start) { <p class="muted">{{ portal.event_start | date: 'dd/MM/yyyy' }}@if (portal.event_end && portal.event_end !== portal.event_start) { – {{ portal.event_end | date: 'dd/MM/yyyy' }} }</p> }
        </header>

        <section class="portal-card">
          <h2>Vos contreparties</h2>
          @if (message) { <div class="ok" role="status">{{ message }}</div> }
          @if (errorMessage) { <div class="err" role="alert">{{ errorMessage }}</div> }
          @for (d of portal.deliverables; track d.id) {
            <article class="item">
              <div class="item-top">
                <div><b>{{ d.title }}</b><br /><small>{{ types[d.deliverable_type] }} · échéance {{ d.due_date ? (d.due_date | date: 'dd/MM/yyyy') : '—' }}</small></div>
                <span class="badge" [class.done]="d.status === 'delivered'" [class.risk]="d.status === 'at_risk'">{{ statuses[d.status] }}</span>
              </div>
              @if (d.asset_url) { <p class="asset">Asset envoyé : <a [href]="d.asset_url" target="_blank" rel="noopener noreferrer">{{ d.asset_url }}</a></p> }
              @if (d.status !== 'delivered') {
                <div class="send">
                  <input type="url" placeholder="Lien vers votre asset (https://…)" [(ngModel)]="urls[d.id]" [attr.aria-label]="'Lien pour ' + d.title" />
                  <button type="button" class="btn" [disabled]="!urls[d.id] || sending === d.id" (click)="submit(d.id)">{{ sending === d.id ? 'Envoi…' : 'Envoyer' }}</button>
                </div>
              }
            </article>
          } @empty { <p class="muted">Aucune contrepartie pour le moment.</p> }
        </section>

        <section class="portal-card">
          <h2>Échéancier de paiement</h2>
          @for (p of portal.payments; track $index) {
            <div class="item item-top">
              <div><b>{{ p.label }}</b><br /><small>Échéance {{ p.due_date ? (p.due_date | date: 'dd/MM/yyyy') : '—' }}</small></div>
              <div class="right"><b>{{ fmt(p.amount, p.currency) }}</b><br /><span class="badge" [class.done]="p.status === 'paid'" [class.risk]="p.status === 'overdue'">{{ pay[p.status] }}</span></div>
            </div>
          } @empty { <p class="muted">Aucun paiement planifié.</p> }
        </section>
      }
    </main>
  `,
  styles: [`
    :host{display:block;min-height:100vh;background:var(--paper)}
    .portal{max-width:760px;margin:0 auto;padding:24px 16px 60px;display:grid;gap:16px}
    .portal-head{padding:12px 4px}
    .portal-head h1{font-size:clamp(24px,6vw,32px);line-height:1.15}
    .eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--violet);font-weight:600}
    .portal-card{background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:var(--sh);padding:20px}
    .portal-card h1,.portal-card h2{font-size:18px;margin-bottom:12px}
    .item{padding:14px 0;border-bottom:1px solid var(--line)}
    .item:last-child{border-bottom:0}
    .item-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .right{text-align:right}
    small,.muted{color:var(--tx-2);font-size:12.5px}
    .badge{display:inline-block;padding:4px 11px;border-radius:20px;font-size:12px;font-weight:500;background:var(--sub);color:var(--tx-2);white-space:nowrap}
    .badge.done{background:rgba(15,169,125,.12);color:var(--gain)}
    .badge.risk{background:rgba(232,69,95,.12);color:var(--risk)}
    .send{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
    .send input{flex:1;min-width:200px;padding:12px 14px;border-radius:13px;border:1px solid var(--line-2);background:var(--card);color:var(--tx);font:inherit}
    .asset{font-size:13px;margin-top:8px;word-break:break-all}
    .asset a{color:var(--violet)}
    .ok{padding:10px 14px;border-radius:12px;background:rgba(15,169,125,.12);color:var(--gain);font-size:13px;margin-bottom:10px}
    .err{padding:10px 14px;border-radius:12px;background:rgba(232,69,95,.1);color:var(--risk);font-size:13px;margin-bottom:10px}
    @media (max-width:520px){.item-top{flex-direction:column}.right{text-align:left}.send .btn{width:100%}}
  `]
})
export class SponsorPortalComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(SponsorsDataService);

  state: 'loading' | 'ready' | 'invalid' | 'network' = 'loading';
  portal: PortalData | null = null;
  urls: Record<string, string> = {};
  sending: string | null = null;
  message = '';
  errorMessage = '';
  private token = '';

  readonly types = DELIVERABLE_TYPE_LABELS;
  readonly statuses = DELIVERABLE_STATUS_LABELS;
  readonly pay = PAYMENT_STATUS_LABELS;

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.load();
  }

  fmt(value: number | string, currency: string): string { return money(value, currency); }

  load(): void {
    this.state = 'loading';
    this.data.portal(this.token).subscribe({
      next: portal => { this.portal = portal; this.state = 'ready'; },
      error: (e: HttpErrorResponse) => { this.state = e.status === 0 ? 'network' : 'invalid'; }
    });
  }

  submit(id: string): void {
    this.sending = id;
    this.message = '';
    this.errorMessage = '';
    this.data.submitAsset(this.token, id, (this.urls[id] ?? '').trim()).subscribe({
      next: portal => { this.portal = portal; this.urls[id] = ''; this.sending = null; this.message = 'Merci ! Votre lien a bien été transmis à l\'organisateur.'; },
      error: (e: HttpErrorResponse) => {
        this.sending = null;
        this.errorMessage = e.status === 0 ? 'Connexion impossible, réessayez.' : (e.error?.detail ?? 'Envoi impossible.');
        if (e.status === 404 || e.status === 410) this.state = 'invalid';
      }
    });
  }
}
