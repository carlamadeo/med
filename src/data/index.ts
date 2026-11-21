export {
    DriveClient,
    DriveError,
    DriveConflictError,
    DriveSessionError,
    DRIVE_SCOPE,
    CALENDAR_SCOPE,
} from './drive-api';

export {
    DriveAuthRepository,
} from './drive-auth-repository';

export {
    DriveStudyRepository,
} from './drive-study-repository';

export {
    DriveOperationRepository,
} from './drive-operation-repository';

export {
    DrivePortalRepository,
} from './drive-portal-repository';

export {
    DriveDoctorRepository,
} from './drive-doctor-repository';

export {
    DriveMedicalEventRepository,
} from './drive-medical-event-repository';

export {
    DriveEpisodeRepository,
} from './drive-episode-repository';

export {
    DriveAppointmentRepository,
} from './drive-appointment-repository';

export {
    DriveIntakeRepository,
} from './drive-intake-repository';

export {
    GoogleCalendarRepository,
} from './google-calendar';

import {DriveClient} from './drive-api';
import {DriveAuthRepository} from './drive-auth-repository';
import {DriveStudyRepository} from './drive-study-repository';
import {DriveOperationRepository} from './drive-operation-repository';
import {DrivePortalRepository} from './drive-portal-repository';
import {DriveDoctorRepository} from './drive-doctor-repository';
import {DriveMedicalEventRepository} from './drive-medical-event-repository';
import {DriveEpisodeRepository} from './drive-episode-repository';
import {DriveAppointmentRepository} from './drive-appointment-repository';
import {DriveIntakeRepository} from './drive-intake-repository';
import {GoogleCalendarRepository} from './google-calendar';

const driveClient = new DriveClient();
export {driveClient};
export const driveAuth = new DriveAuthRepository(driveClient);
export const driveStudyRepo = new DriveStudyRepository(driveClient);
export const driveOperationRepo = new DriveOperationRepository(driveClient);
export const drivePortalRepo = new DrivePortalRepository(driveClient);
export const driveDoctorRepo = new DriveDoctorRepository(driveClient);
export const driveMedicalEventRepo = new DriveMedicalEventRepository(driveClient);
export const driveEpisodeRepo = new DriveEpisodeRepository(driveClient);
export const driveAppointmentRepo = new DriveAppointmentRepository(driveClient);
export const driveIntakeRepo = new DriveIntakeRepository(driveClient);
export const googleCalendarRepo = new GoogleCalendarRepository(driveClient);

export type {DriveFileMetadata, IntakeCandidate} from '@domain/repository';