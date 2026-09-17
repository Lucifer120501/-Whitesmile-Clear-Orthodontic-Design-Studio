<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Patient extends Model
{
    protected $table = 'ws_patients';

    protected $fillable = [
        'first_name',
        'last_name',
        'date_of_birth',
        'gender',
        'phone',
        'email',
        'address',
        'doctor_id',
        'clinic_id',
        'mrn',
        'status',
    ];

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class, 'doctor_id');
    }

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class, 'clinic_id');
    }
}
