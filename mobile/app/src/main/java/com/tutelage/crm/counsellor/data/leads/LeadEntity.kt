package com.tutelage.crm.counsellor.data.leads

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

/** `updatedAt` backs the ORDER BY on both cache queries; name/mobile back the
 *  offline search. Without them every keystroke scanned the whole cache. */
@Entity(
    tableName = "leads",
    indices = [Index("updatedAt"), Index("name"), Index("mobile")],
)
data class LeadEntity(
    @PrimaryKey val id: Long,
    val name: String?,
    val mobile: String?,
    val mobile2: String?,
    val email: String?,
    val city: String?,
    val state: String?,
    val leadStatus: String?,
    val leadSubStatus: String?,
    val intrestedCourse: String?,
    val updatedAt: String?,
)

@Serializable
data class LeadDto(
    val id: Long,
    val name: String? = null,
    val mobile: String? = null,
    val mobile2: String? = null,
    val email: String? = null,
    val city: String? = null,
    val state: String? = null,
    val leadStatus: String? = null,
    val leadSubStatus: String? = null,
    val intrestedCourse: String? = null,
    val updatedAt: String? = null,
)

fun LeadDto.toEntity() = LeadEntity(
    id = id,
    name = name,
    mobile = mobile,
    mobile2 = mobile2,
    email = email,
    city = city,
    state = state,
    leadStatus = leadStatus,
    leadSubStatus = leadSubStatus,
    intrestedCourse = intrestedCourse,
    updatedAt = updatedAt,
)
