import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Subject, combineLatest, map, startWith } from 'rxjs';
import { EventContextService } from '../twin/event-context.service';
import { ApiSponsor } from './sponsors.models';

/** État partagé : événement sélectionné + signal de rechargement après chaque mutation. */
@Injectable({ providedIn: 'root' })
export class SponsorsStateService {
  private readonly ctx = inject(EventContextService);
  private readonly refreshSignal = new Subject<void>();
  private readonly dealPanel = new BehaviorSubject<string | null>(null);
  private readonly sponsorForm = new BehaviorSubject<{ sponsor: ApiSponsor | null } | null>(null);

  /** Émet l'événement courant (ou null) à chaque changement d'événement ou après refresh(). */
  readonly context$ = combineLatest([this.ctx.selected$, this.refreshSignal.pipe(startWith(undefined))]).pipe(map(([event]) => event));
  readonly openDealId$ = this.dealPanel.asObservable();
  readonly sponsorForm$ = this.sponsorForm.asObservable();

  get event() { return this.ctx.current; }

  refresh(): void { this.refreshSignal.next(); }
  openDeal(id: string | null): void { this.dealPanel.next(id); }
  openSponsorForm(sponsor: ApiSponsor | null = null): void { this.sponsorForm.next({ sponsor }); }
  closeSponsorForm(): void { this.sponsorForm.next(null); }
}
