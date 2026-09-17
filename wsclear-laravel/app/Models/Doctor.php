<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Doctor extends Authenticatable
{
    use Notifiable;

    protected $table = 'ws_doctors';

    protected $fillable = [
        'name',
        'email',
        'password',
        'clinic_id',
        'specialization',
        'phone',
        'address',
        'country_code',
        'license_number',
        'status',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $casts = [
        'email_verified_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class, 'clinic_id');
    }

    public function patients()
    {
        return $this->hasMany(Patient::class, 'doctor_id');
    }
}
