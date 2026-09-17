<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\Doctor;
use App\Models\Mr;
use App\Models\Clinic;
use App\Models\Patient;
use Illuminate\Support\Facades\DB;
use App\Support\LegacyMd5Hasher;

class LegacyDataMigrate extends Command
{
    protected $signature = 'legacy:migrate';
    protected $description = 'Migrate data from legacy Laravel database to new system';

    public function handle(): int
    {
        $this->info('Starting legacy data migration...');

        // Migrate clinics
        $this->migrateClinics();

        // Migrate doctors
        $this->migrateDoctors();

        // Migrate MRs
        $this->migrateMRS();

        // Migrate patients
        $this->migratePatients();

        $this->info('Legacy data migration completed successfully!');
        return Command::SUCCESS;
    }

    protected function migrateClinics(): void
    {
        $this->info('Migrating clinics...');
        
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        DB::table('ws_clinics')->truncate();
        DB::statement('SET FOREIGN_KEY_CHECKS=1');

        $clinics = DB::connection('legacy')->table('ws_clinics')->get();
        
        foreach ($clinics as $clinic) {
            Clinic::updateOrCreate(
                ['id' => $clinic->id],
                [
                    'name' => $clinic->name,
                    'address' => $clinic->address ?? '',
                    'phone' => $clinic->phone ?? '',
                    'email' => $clinic->email ?? '',
                    'country_code' => $clinic->country_code ?? '+1',
                    'city' => $clinic->city ?? '',
                    'state' => $clinic->state ?? '',
                    'zip_code' => $clinic->zip_code ?? '',
                ]
            );
        }

        $this->info("Migrated {$clinics->count()} clinics");
    }

    protected function migrateDoctors(): void
    {
        $this->info('Migrating doctors...');
        
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        DB::table('ws_doctors')->truncate();
        DB::statement('SET FOREIGN_KEY_CHECKS=1');

        $doctors = DB::connection('legacy')->table('ws_doctors')->get();
        
        foreach ($doctors as $doctor) {
            Doctor::updateOrCreate(
                ['id' => $doctor->id],
                [
                    'name' => $doctor->name,
                    'email' => $doctor->email,
                    'password' => $doctor->password,
                    'clinic_id' => $doctor->clinic_id,
                    'specialization' => $doctor->specialization ?? '',
                    'phone' => $doctor->phone ?? '',
                    'address' => $doctor->address ?? '',
                    'country_code' => $doctor->country_code ?? '+1',
                    'license_number' => $doctor->license_number ?? '',
                    'status' => $doctor->status ?? 'active',
                ]
            );
        }

        $this->info("Migrated {$doctors->count()} doctors");
    }

    protected function migrateMRS(): void
    {
        $this->info('Migrating MRs...');
        
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        DB::table('ws_mrs')->truncate();
        DB::statement('SET FOREIGN_KEY_CHECKS=1');

        $mrs = DB::connection('legacy')->table('ws_mrs')->get();
        
        foreach ($mrs as $mr) {
            Mr::updateOrCreate(
                ['id' => $mr->id],
                [
                    'name' => $mr->name,
                    'email' => $mr->email,
                    'password' => $mr->password,
                    'clinic_id' => $mr->clinic_id,
                    'phone' => $mr->phone ?? '',
                    'status' => $mr->status ?? 'active',
                ]
            );
        }

        $this->info("Migrated {$mrs->count()} MRs");
    }

    protected function migratePatients(): void
    {
        $this->info('Migrating patients...');
        
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        DB::table('ws_patients')->truncate();
        DB::statement('SET FOREIGN_KEY_CHECKS=1');

        $patients = DB::connection('legacy')->table('ws_patients')->get();
        
        foreach ($patients as $patient) {
            Patient::updateOrCreate(
                ['id' => $patient->id],
                [
                    'first_name' => $patient->first_name ?? $patient->name ?? '',
                    'last_name' => $patient->last_name ?? '',
                    'date_of_birth' => $patient->date_of_birth ?? null,
                    'gender' => $patient->gender ?? '',
                    'phone' => $patient->phone ?? '',
                    'email' => $patient->email ?? '',
                    'address' => $patient->address ?? '',
                    'doctor_id' => $patient->doctor_id ?? null,
                    'clinic_id' => $patient->clinic_id ?? null,
                    'mrn' => $patient->mrn ?? '',
                    'status' => $patient->status ?? 'active',
                ]
            );
        }

        $this->info("Migrated {$patients->count()} patients");
    }
}
