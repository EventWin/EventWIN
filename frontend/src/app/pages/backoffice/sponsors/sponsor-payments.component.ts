import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { SponsorPageBase, SpStateComponent, daysLate, todayIso } from '../../../sponsors/sponsors-ui';
import { ApiSponsorPayment, PAYMENT_STATUS_LABELS, money } from '../../../sponsors/sponsors.models';

@Component({
  selector: 'app-sponsor-payments',
  standalone: true,
  imports: [CommonModule, SpStateComponent],
  template: `
    <sp-state [event]="event" [loading]="loading" [error]="error" [forbidden]="forbidden" [hasContent]="loaded" (retry)="reload()">
      @if (loaded) {
        <div class="sp-stats">
          <div class="stat"><div class="lab">Facturé</div><div class="val">{{ fmt(invoiced) }}</div><div class="foot">En attente de règlement</div></div>
          <div class="stat lit"><div class="lab">Encaissé</div><div class="val">{{ fmt(collected) }}</div><div class="foot">Paiements reçus</div></div>
          <div class="stat"><div class="lab">En retard</div><div class="val">{{ fmt(late) }}</div><div class="foot"><span class="chip" [class.risk]="late > 0" [class.gain]="late === 0">{{ late > 0 ? 'À relancer' : 'Rien en retard' }}</span></div></div>
          <div class="stat"><div class="lab">À venir sous 30 jours</div><div class="val">{{ fmt(upcoming) }}</div><div class="foot">Échéances proches</div></div>
        </div>

        @if (!payments.length) {
          <div class="empty"><h4>Aucun paiement</h4><p>L'échéancier est créé automatiquement à la signature d'un dossier.</p></div>
        } @else {
          <div class="tw">
            <table>
              <thead><tr><th>Sponsor</th><th>Libellé</th><th>Montant</th><th>Échéance</th><th>Statut</th><th>Facture</th><th>Action</th></tr></thead>
              <tbody>
                @for (p of payments; track p.id) {
                  <tr [class.sp-row-late]="isLate(p)">
                    <td><b>{{ p.sponsor_name }}</b></td>
                    <td>{{ p.label }}</td>
                    <td class="sp-money">{{ fmt(p.amount, p.currency) }}</td>
                    <td>{{ p.due_date || '—' }} @if (isLate(p)) { <span class="chip risk">{{ lateDays(p) }} j de retard</span> }</td>
                    <td><span class="chip" [class.gain]="p.status === 'paid'" [class.risk]="isLate(p)" [class.warn]="p.status === 'invoiced' && !isLate(p)">{{ labels[p.status] }}</span></td>
                    <td>{{ p.invoice_ref || '—' }}</td>
                    <td><div class="row-actions">
                      @if (p.status === 'planned' || p.status === 'overdue') { <button type="button" class="sp-link" (click)="invoice(p)">Facturer</button> }
                      @if (p.status !== 'paid') { <button type="button" class="sp-link" (click)="markPaid(p)">Marquer payé</button> }
                    </div></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </sp-state>
  `
})
export class SponsorPaymentsComponent extends SponsorPageBase {
  payments: ApiSponsorPayment[] = [];
  readonly labels = PAYMENT_STATUS_LABELS;

  protected fetch(eventId: string): Observable<unknown> {
    return this.data.payments(eventId).pipe(tap(list => (this.payments = list)));
  }

  fmt(value: number | string, currency = 'EUR'): string { return money(value, currency); }
  private sum(list: ApiSponsorPayment[]): number { return list.reduce((acc, p) => acc + Number(p.amount), 0); }
  isLate(p: ApiSponsorPayment): boolean { return p.status !== 'paid' && (p.status === 'overdue' || (!!p.due_date && p.due_date < todayIso())); }
  lateDays(p: ApiSponsorPayment): number { return daysLate(p.due_date); }

  get invoiced(): number { return this.sum(this.payments.filter(p => p.status === 'invoiced')); }
  get collected(): number { return this.sum(this.payments.filter(p => p.status === 'paid')); }
  get late(): number { return this.sum(this.payments.filter(p => this.isLate(p))); }
  get upcoming(): number {
    const limit = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return this.sum(this.payments.filter(p => !this.isLate(p) && p.status !== 'paid' && !!p.due_date && p.due_date <= limit));
  }

  invoice(p: ApiSponsorPayment): void {
    const ref = prompt('Référence de la facture :', p.invoice_ref || '');
    if (ref === null) return;
    this.run(this.data.updatePayment(p.id, { status: 'invoiced', invoice_ref: ref.trim() }));
  }

  markPaid(p: ApiSponsorPayment): void {
    this.run(this.data.updatePayment(p.id, { status: 'paid', paid_at: todayIso() }));
  }
}
