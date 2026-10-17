import { CommonModule } from '@angular/common';
import { Component, Directive, EventEmitter, Input, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { SponsorsDataService } from './sponsors-data.service';
import { SponsorsStateService } from './sponsors-state.service';
import { ApiError, PortalLink } from './sponsors.models';

/** Gère les 3 états communs : aucun événement, chargement, erreur (avec « Réessayer »). */
@Component({
  selector: 'sp-state',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (!event) {
      <div class="empty">
        <h4>Aucun événement sélectionné</h4>
        <p>Choisissez un événement pour gérer son sponsoring.</p>
        <a class="btn btn-sm" routerLink="/app/events">Choisir un événement</a>
      </div>
    } @else {
      @if (error) {
        <div class="sp-error" role="alert">
          <span>{{ error }}</span>
          @if (forbidden) { <a class="btn btn-sm" routerLink="/organizer-login">Se connecter</a> }
          <button type="button" class="btn btn-sm" (click)="retry.emit()">Réessayer</button>
        </div>
      }
      @if (loading && !hasContent) { <div class="muted sp-loading">Chargement…</div> }
      <ng-content></ng-content>
    }
  `
})
export class SpStateComponent {
  @Input() event: { id: string; name: string } | null = null;
  @Input() loading = false;
  @Input() error = '';
  @Input() forbidden = false;
  @Input() hasContent = false;
  @Output() retry = new EventEmitter<void>();
}

/** Base des pages sponsors : recharge à chaque changement d'événement ou mutation. */
@Directive()
export abstract class SponsorPageBase implements OnInit, OnDestroy {
  protected readonly state = inject(SponsorsStateService);
  protected readonly data = inject(SponsorsDataService);

  event: { id: string; name: string } | null = null;
  loading = false;
  loaded = false;
  error = '';
  forbidden = false;
  private sub?: Subscription;
  private req?: Subscription;
  private lastEventId: string | null = null;

  protected abstract fetch(eventId: string): Observable<unknown>;

  ngOnInit(): void {
    this.sub = this.state.context$.subscribe(event => {
      if ((event?.id ?? null) !== this.lastEventId) {
        this.loaded = false;
        this.lastEventId = event?.id ?? null;
        this.onEventChanged();
      }
      this.event = event;
      this.reload();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.req?.unsubscribe();
  }

  protected onEventChanged(): void {}

  reload(): void {
    this.req?.unsubscribe();
    if (!this.event) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.error = '';
    this.forbidden = false;
    this.req = this.fetch(this.event.id).subscribe({
      next: () => { this.loading = false; this.loaded = true; },
      error: (e: ApiError) => this.fail(e)
    });
  }

  protected fail(e: ApiError): void {
    this.loading = false;
    this.error = e.message;
    this.forbidden = e.status === 403;
  }

  /** Exécute une mutation, recharge toutes les pages en cas de succès, affiche l'erreur sinon. */
  protected run<T>(source: Observable<T>, onOk?: (value: T) => void): void {
    this.error = '';
    source.subscribe({
      next: value => { onOk?.(value); this.state.refresh(); },
      error: (e: ApiError) => this.fail(e)
    });
  }
}

/** Bouton + fenêtre « Lien portail » : copier le lien ou l'envoyer par e-mail au contact. */
@Component({
  selector: 'sp-portal-link',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <button type="button" class="btn btn-sm" (click)="open()">{{ label }}</button>
    @if (visible) {
      <div class="sp-overlay" (click)="close()"></div>
      <div class="sp-modal" role="dialog" aria-label="Lien du portail sponsor">
        <h3>Portail sponsor</h3>
        <p class="muted tiny">Le sponsor n'a pas de compte : ce lien personnel lui donne accès à ses contreparties et à son échéancier.</p>
        @if (loading) { <p class="muted">Génération du lien…</p> }
        @if (error) { <div class="sp-error" role="alert"><span>{{ error }}</span></div> }
        @if (link) {
          <div class="field">
            <label>Lien (valable {{ link.expires_in_days }} jours)</label>
            <div class="sp-row">
              <input class="in" readonly [value]="link.url" (focus)="$any($event.target).select()" />
              <button type="button" class="btn btn-sm" (click)="copy()">Copier</button>
            </div>
          </div>
          <div class="field">
            <label>Envoyer par e-mail à</label>
            <div class="sp-row">
              <input class="in" type="email" [(ngModel)]="email" placeholder="contact@sponsor.com" />
              <button type="button" class="btn btn-sm btn-ai" [disabled]="sending || !email" (click)="send()">
                {{ sending ? 'Envoi…' : 'Envoyer' }}
              </button>
            </div>
          </div>
        }
        @if (message) { <div class="sp-ok" role="status">{{ message }}</div> }
        <div class="form-actions"><button type="button" class="btn btn-sm" (click)="close()">Fermer</button></div>
      </div>
    }
  `
})
export class PortalLinkComponent {
  private readonly data = inject(SponsorsDataService);
  private readonly state = inject(SponsorsStateService);
  @Input({ required: true }) dealId = '';
  @Input() sponsorEmail = '';
  @Input() label = 'Lien portail';

  visible = false;
  loading = false;
  sending = false;
  link: PortalLink | null = null;
  email = '';
  message = '';
  error = '';

  open(): void {
    this.visible = true;
    this.link = null;
    this.message = '';
    this.error = '';
    this.email = this.sponsorEmail;
    this.loading = true;
    this.data.portalLink(this.dealId).subscribe({
      next: link => { this.link = link; this.loading = false; },
      error: (e: ApiError) => { this.error = e.message; this.loading = false; }
    });
  }

  close(): void { this.visible = false; }

  async copy(): Promise<void> {
    if (!this.link) return;
    try {
      await navigator.clipboard.writeText(this.link.url);
      this.message = 'Lien copié dans le presse-papiers.';
    } catch {
      this.message = 'Copie impossible : sélectionnez le lien et copiez-le manuellement.';
    }
  }

  send(): void {
    this.sending = true;
    this.message = '';
    this.error = '';
    this.data.portalLink(this.dealId, true, this.email).subscribe({
      next: link => {
        this.sending = false;
        this.link = link;
        if (link.email_sent) {
          this.message = `E-mail envoyé à ${link.sent_to}.`;
          this.state.refresh();
        } else {
          this.error = link.email_error ?? "L'e-mail n'a pas pu être envoyé.";
        }
      },
      error: (e: ApiError) => { this.sending = false; this.error = e.message; }
    });
  }
}

export function currentParticipantId(): string { return localStorage.getItem('participant_id') ?? ''; }
export function currentRole(): string { return localStorage.getItem('participant_role') ?? ''; }
export function todayIso(): string { return new Date().toISOString().slice(0, 10); }
export function daysLate(dueDate: string | null): number {
  if (!dueDate) return 0;
  const diff = Date.now() - new Date(dueDate + 'T00:00:00').getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}
