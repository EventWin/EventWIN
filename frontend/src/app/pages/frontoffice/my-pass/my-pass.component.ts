import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { ParticipantService } from '../../../services/participant.service';

interface EventItem {
  id: string;
  name: string;
  location: string;
  start_date: string;
  end_date: string;
  status: string;
}

@Component({
  selector: 'app-my-pass',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './my-pass.component.html',
  styleUrls: ['./my-pass.component.css']
})
export class MyPassComponent implements OnInit {
  activeTab: 'festival' | 'seminar' = 'festival';
  participantName: string = 'Participant EventTwin';
  participantRole: string = 'Participant Invité';
  participantOrg: string = 'EventWIN Technologies';
  ticketCodeFestival: string = 'ET-FEST-2026-VIP-894';
  ticketCodeSeminar: string = 'ET-CHX-2026-TGV-402';

  qrUrlFestival: string = '';
  qrUrlSeminar: string = '';

  constructor(
    private http: HttpClient,
    private participantService: ParticipantService
  ) {}

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      const storedName = localStorage.getItem('participant_name');
      if (storedName) {
        this.participantName = storedName;
      }
      const storedRole = localStorage.getItem('participant_role');
      if (storedRole === 'organizer') {
        this.participantRole = 'Organisateur & Accrédité VIP';
      } else if (storedRole === 'admin') {
        this.participantRole = 'Administrateur & Accrédité VIP';
      } else {
        this.participantRole = 'Pass Invité d’Honneur VIP';
      }

      const id = localStorage.getItem('participant_id');
      if (id) {
        this.participantService.getParticipant(id).subscribe({
          next: (p) => {
            if (p?.full_name) {
              this.participantName = p.full_name;
              localStorage.setItem('participant_name', p.full_name);
            }
            if (p?.organization) {
              this.participantOrg = p.organization;
            }
            this.generateQrCodes();
          },
          error: () => {
            this.generateQrCodes();
          }
        });
      } else {
        this.generateQrCodes();
      }
    }
  }

  generateQrCodes(): void {
    this.qrUrlFestival = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=EVENTWIN-PASS-NEONWAVES-${encodeURIComponent(this.participantName)}-${this.ticketCodeFestival}`;
    this.qrUrlSeminar = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=EVENTWIN-BOARDING-CHAMONIX-${encodeURIComponent(this.participantName)}-${this.ticketCodeSeminar}`;
  }

  setTab(tab: 'festival' | 'seminar'): void {
    this.activeTab = tab;
  }

  printOrDownloadPdf(): void {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }
}
