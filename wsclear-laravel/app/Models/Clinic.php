<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Clinic extends Model
{
    protected $table = 'ws_clinics';

    protected $fillable = [
        'name',
        'address',
        'phone',
        'email',
        'country_code',
        'city',
        'state',
        'zip_code',
    ];

    public function doctors()
    {
        return $this->hasMany(Doctor::class, 'clinic_id');
    }

    public function mrs()
    {
        return $this->hasMany(Mr::class, 'clinic_id');
    }

    public function patients()
    {
        return $this->hasMany(Patient::class, 'clinic_id');
    }
}
