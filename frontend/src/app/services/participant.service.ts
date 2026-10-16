import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ParticipantService {
  private apiUrl = '/api/participants/';

  constructor(private http: HttpClient) {}

  login(email: string, password?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}login/`, { email, password });
  }

  register(fullName: string, email: string, password?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}register/`, { full_name: fullName, email, password });
  }

  createOrganizer(fullName: string, email: string): Observable<any> {
    return this.http.post(`${this.apiUrl}create_organizer/`, { full_name: fullName, email });
  }

  getOrganizers(): Observable<any> {
    return this.http.get(`${this.apiUrl}get_organizers/`);
  }

  getParticipant(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}${id}/`);
  }

  deleteParticipant(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}${id}/`);
  }

  addPreference(participantId: string, type: string, value: string): Observable<any> {
    return this.http.post('/api/participant-preferences/', {
      participant: participantId,
      preference_type: type,
      value: value,
      weight: 1
    });
  }

  addConstraint(participantId: string, type: string, value: string, isHard: boolean): Observable<any> {
    return this.http.post('/api/participant-constraints/', {
      participant: participantId,
      constraint_type: type,
      value: value,
      is_hard_constraint: isHard
    });
  }

  updatePreference(prefId: string, value: string): Observable<any> {
    return this.http.patch(`/api/participant-preferences/${prefId}/`, {
      value: value
    });
  }

  updateConstraint(constId: string, value: string): Observable<any> {
    return this.http.patch(`/api/participant-constraints/${constId}/`, {
      value: value
    });
  }
}
