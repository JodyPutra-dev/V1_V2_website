#!/usr/bin/env bash
set -Eeuo pipefail

URI='mongodb://admin:12345678@127.0.0.1:27017/?authSource=admin'
DB='urine-disease-detection'
COLL='predictions'

EXPECTED_K6_USERS=10
EXPECTED_KEEP=128

STAMP="$(date +%Y%m%d_%H%M%S)"
WORKDIR="/var/backups/k6-predictions-cleanup-$STAMP"
QUERY_FILE="$WORKDIR/non-k6-query.json"
BACKUP_FILE="$WORKDIR/non-k6-predictions.archive.gz"
VERIFY_DB="${DB}-verify-${STAMP}"

die() {
    echo
    echo "ERROR: $*" >&2
    exit 1
}

echo "======================================================================"
echo "CLEANUP 27 JUTA PREDICTIONS K6"
echo "Backup folder: $WORKDIR"
echo "======================================================================"

for COMMAND in mongosh mongodump mongorestore gzip; do
    command -v "$COMMAND" >/dev/null 2>&1 \
        || die "Command tidak ditemukan: $COMMAND"
done

mkdir -p "$WORKDIR"
chmod 700 "$WORKDIR"

STATE_JS="$(cat <<'JS'
const d = db.getSiblingDB("urine-disease-detection");

const k6Pattern =
    /^k6user(?:0[1-9]|10)@udetectupnvj\.com$/i;

const users = d.users.find(
    {},
    { _id: 1, email: 1 }
).toArray();

const k6Users = users.filter(user =>
    k6Pattern.test(String(user.email))
);

const nonK6Users = users.filter(user =>
    !k6Pattern.test(String(user.email))
);

const knownUserIds = new Set(
    users.map(user => user._id.toString())
);

const predictionUserIds =
    d.predictions.distinct("user");

const unknownUserIds = predictionUserIds.filter(userId =>
    userId === null ||
    !knownUserIds.has(userId.toString())
);

const nullOrMissing = d.predictions.countDocuments(
    { user: null },
    { hint: "user_1" }
);

const nonK6Count = d.predictions.countDocuments(
    {
        user: {
            $in: nonK6Users.map(user => user._id)
        }
    },
    { hint: "user_1" }
);

const stats = d.runCommand({
    collStats: "predictions"
});

const total = Number(stats.count);

print([
    k6Users.length,
    nonK6Users.length,
    total,
    nonK6Count,
    nullOrMissing,
    unknownUserIds.length
].join("\t"));
JS
)"

get_state() {
    mongosh "$URI" \
        --quiet \
        --eval "$STATE_JS"
}

echo
echo "======================================================================"
echo "1. PREFLIGHT VALIDATION"
echo "======================================================================"

STATE_BEFORE="$(get_state)"

IFS=$'\t' read -r \
    K6_USER_COUNT \
    NON_K6_USER_COUNT \
    TOTAL_COUNT \
    NON_K6_COUNT \
    NULL_COUNT \
    UNKNOWN_COUNT <<< "$STATE_BEFORE"

echo "User k6             : $K6_USER_COUNT"
echo "User non-k6         : $NON_K6_USER_COUNT"
echo "Total prediction    : $TOTAL_COUNT"
echo "Prediction non-k6   : $NON_K6_COUNT"
echo "User null/missing   : $NULL_COUNT"
echo "User tidak dikenal  : $UNKNOWN_COUNT"

[[ "$K6_USER_COUNT" == "$EXPECTED_K6_USERS" ]] \
    || die "User k6 bukan $EXPECTED_K6_USERS."

[[ "$NON_K6_COUNT" == "$EXPECTED_KEEP" ]] \
    || die "Prediction non-k6 bukan $EXPECTED_KEEP."

[[ "$NULL_COUNT" == "0" ]] \
    || die "Ada prediction dengan user null/missing."

[[ "$UNKNOWN_COUNT" == "0" ]] \
    || die "Ada prediction milik user yang tidak dikenal."

K6_DOCUMENTS=$((TOTAL_COUNT - NON_K6_COUNT))

echo "Prediction k6       : $K6_DOCUMENTS"

echo
echo "Memastikan tidak ada proses yang masih menulis prediction..."
sleep 5

STATE_AFTER_WAIT="$(get_state)"

[[ "$STATE_BEFORE" == "$STATE_AFTER_WAIT" ]] || {
    echo "Sebelum: $STATE_BEFORE"
    echo "Sesudah: $STATE_AFTER_WAIT"
    die "Data masih berubah. Pastikan k6 dan API prediction sudah dihentikan."
}

echo "OK: Collection stabil."

echo
echo "======================================================================"
echo "2. BUAT FILTER UNTUK 128 DATA NON-K6"
echo "======================================================================"

QUERY_JS="$(cat <<'JS'
const d = db.getSiblingDB("urine-disease-detection");

const k6Pattern =
    /^k6user(?:0[1-9]|10)@udetectupnvj\.com$/i;

const users = d.users.find(
    {},
    { _id: 1, email: 1 }
).toArray();

const nonK6Ids = users
    .filter(user =>
        !k6Pattern.test(String(user.email))
    )
    .map(user => user._id);

print(
    EJSON.stringify({
        user: {
            $in: nonK6Ids
        }
    })
);
JS
)"

mongosh "$URI" \
    --quiet \
    --eval "$QUERY_JS" > "$QUERY_FILE"

echo "Query backup:"
cat "$QUERY_FILE"

echo
echo "======================================================================"
echo "3. BACKUP 128 PREDICTION NON-K6"
echo "======================================================================"

mongodump \
    --uri="$URI" \
    --db="$DB" \
    --collection="$COLL" \
    --queryFile="$QUERY_FILE" \
    --archive="$BACKUP_FILE" \
    --gzip

gzip -t "$BACKUP_FILE" \
    || die "Backup gzip rusak."

ls -lh "$BACKUP_FILE"

echo
echo "======================================================================"
echo "4. VERIFIKASI BACKUP DI DATABASE SEMENTARA"
echo "======================================================================"

mongorestore \
    --uri="$URI" \
    --archive="$BACKUP_FILE" \
    --gzip \
    --nsInclude="$DB.$COLL" \
    --nsFrom="$DB.$COLL" \
    --nsTo="$VERIFY_DB.$COLL"

VERIFY_COUNT="$(
    mongosh "$URI" \
        --quiet \
        --eval \
        "print(db.getSiblingDB('$VERIFY_DB').predictions.countDocuments({}))"
)"

echo "Jumlah prediction hasil restore sementara: $VERIFY_COUNT"

if [[ "$VERIFY_COUNT" != "$EXPECTED_KEEP" ]]; then
    echo
    echo "Database sementara tidak dihapus agar bisa diperiksa:"
    echo "$VERIFY_DB"
    die "Backup tidak berisi tepat $EXPECTED_KEEP dokumen."
fi

mongosh "$URI" \
    --quiet \
    --eval \
    "printjson(db.getSiblingDB('$VERIFY_DB').dropDatabase())"

echo "OK: Backup berhasil diverifikasi berisi tepat 128 prediction."

echo
echo "======================================================================"
echo "5. VALIDASI TERAKHIR SEBELUM DROP"
echo "======================================================================"

STATE_FINAL_CHECK="$(get_state)"

[[ "$STATE_BEFORE" == "$STATE_FINAL_CHECK" ]] || {
    echo "Awal    : $STATE_BEFORE"
    echo "Sekarang: $STATE_FINAL_CHECK"
    die "Data berubah setelah backup. Jangan drop collection."
}

echo
echo "Backup aman:"
echo "$BACKUP_FILE"
echo
echo "Collection yang akan di-drop:"
echo "$DB.$COLL"
echo
echo "Dokumen k6 yang akan hilang : $K6_DOCUMENTS"
echo "Dokumen non-k6 dipulihkan   : $EXPECTED_KEEP"
echo
echo "Ketik persis berikut untuk melanjutkan:"
echo "DROP-RESTORE-128"
echo

read -r CONFIRMATION

[[ "$CONFIRMATION" == "DROP-RESTORE-128" ]] \
    || die "Dibatalkan oleh user."

echo
echo "======================================================================"
echo "6. DROP COLLECTION PREDICTIONS"
echo "======================================================================"

DROP_RESULT="$(
    mongosh "$URI" \
        --quiet \
        --eval '
            const d = db.getSiblingDB(
                "urine-disease-detection"
            );

            print(
                d.predictions.drop()
                    ? "DROP_OK"
                    : "DROP_FAILED"
            );
        '
)"

echo "$DROP_RESULT"

[[ "$DROP_RESULT" == "DROP_OK" ]] \
    || die "Collection gagal di-drop."

echo
echo "======================================================================"
echo "7. RESTORE 128 PREDICTION NON-K6"
echo "======================================================================"

if ! mongorestore \
    --uri="$URI" \
    --archive="$BACKUP_FILE" \
    --gzip \
    --nsInclude="$DB.$COLL"
then
    echo
    echo "RESTORE GAGAL."
    echo "Jangan hidupkan aplikasi."
    echo
    echo "Backup aman berada di:"
    echo "$BACKUP_FILE"
    echo
    echo "Ulangi restore dengan:"
    echo
    echo "mongorestore \\"
    echo "  --uri='$URI' \\"
    echo "  --archive='$BACKUP_FILE' \\"
    echo "  --gzip \\"
    echo "  --nsInclude='$DB.$COLL'"
    exit 1
fi

echo
echo "======================================================================"
echo "8. VERIFIKASI HASIL AKHIR"
echo "======================================================================"

FINAL_JS="$(cat <<'JS'
const d = db.getSiblingDB("urine-disease-detection");

const k6Pattern =
    /^k6user(?:0[1-9]|10)@udetectupnvj\.com$/i;

const k6Users = d.users.find(
    { email: k6Pattern },
    { _id: 1, email: 1 }
).toArray();

const k6Ids = k6Users.map(user => user._id);

const total = d.predictions.countDocuments({});

const k6Remaining = d.predictions.countDocuments({
    user: {
        $in: k6Ids
    }
});

const indexes = d.predictions
    .getIndexes()
    .map(index => index.name);

printjson({
    totalPrediction: total,
    predictionK6Tersisa: k6Remaining,
    indexes: indexes
});

if (total !== 128) {
    throw new Error(
        "Total prediction bukan 128: " + total
    );
}

if (k6Remaining !== 0) {
    throw new Error(
        "Masih ada prediction k6: " + k6Remaining
    );
}
JS
)"

mongosh "$URI" \
    --quiet \
    --eval "$FINAL_JS"

echo
echo "======================================================================"
echo "CLEANUP BERHASIL"
echo "======================================================================"
echo "Total prediction sekarang : 128"
echo "Prediction k6 sekarang    : 0"
echo "Backup                    : $BACKUP_FILE"
echo
echo "Aplikasi boleh dihidupkan kembali."
