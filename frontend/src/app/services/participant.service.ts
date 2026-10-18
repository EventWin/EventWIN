import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ParticipantService {
  private apiUrl = 'http://localhost:8000/api/participants/';

  constructor(private http: HttpClient) {}

  login(email: string, password?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}login/`, { email, password });
  }

  register(fullName: string, email: string, password?: string, otp?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}register/`, { full_name: fullName, email, password, otp });
  }

  sendOtp(email: string, fullName: string): Observable<any> {
    return this.http.post(`${this.apiUrl}send_otp/`, { email, full_name: fullName });
  }

  verifyOtp(email: string, otp: string): Observable<any> {
    return this.http.post(`${this.apiUrl}verify_otp/`, { email, otp });
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
    return this.http.post('http://localhost:8000/api/participant-preferences/', {
      participant: participantId,
      preference_type: type,
      value: value,
      weight: 1
    });
  }

  addConstraint(participantId: string, type: string, value: string, isHard: boolean): Observable<any> {
    return this.http.post('http://localhost:8000/api/participant-constraints/', {
      participant: participantId,
      constraint_type: type,
      value: value,
      is_hard_constraint: isHard
    });
  }

  updatePreference(prefId: string, value: string): Observable<any> {
    return this.http.patch(`http://localhost:8000/api/participant-preferences/${prefId}/`, {
      value: value
    });
  }

  updateConstraint(constId: string, value: string): Observable<any> {
    return this.http.patch(`http://localhost:8000/api/participant-constraints/${constId}/`, {
      value: value
    });
  }

  getOrganizations(): Observable<any> {
    return this.http.get('http://localhost:8000/api/organizations/');
  }

  updateProfile(id: string, data: { first_name?: string; last_name?: string; full_name?: string; email?: string; phone?: string; organization?: string; photo?: string }): Observable<any> {
    return this.http.patch(`${this.apiUrl}${id}/update_profile/`, data);
  }
}
