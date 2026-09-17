<?php

namespace App\Support;

use Illuminate\Support\Facades\Hash;

class LegacyMd5Hasher
{
    public static function verify($value, $hashedValue): bool
    {
        // Check if it's a legacy MD5 hash
        if (strlen($hashedValue) === 32 && preg_match('/^[a-f0-9]{32}$/', $hashedValue)) {
            return md5($value) === $hashedValue;
        }
        
        // Otherwise use bcrypt
        return Hash::check($value, $hashedValue);
    }

    public static function hash($value): string
    {
        return Hash::make($value);
    }

    public static function needsRehash($hashedValue): bool
    {
        if (strlen($hashedValue) === 32 && preg_match('/^[a-f0-9]{32}$/', $hashedValue)) {
            return true;
        }
        return !Hash::needsRehash($hashedValue);
    }
}
