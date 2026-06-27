#!/usr/bin/env bash
set -Eeuo pipefail

URI='mongodb://admin:12345678@127.0.0.1:27017/?authSource=admin'
MAX_DELETE=1000000

MODE="${1:-check}"

case "$MODE" in
    check)
        export APPLY_DELETE='NO'
        ;;
    --apply)
        export APPLY_DELETE='YES'
        ;;
    *)
        echo "Usage:"
        echo "  $0"
        echo "  $0 --apply"
        exit 1
        ;;
esac

export MAX_DELETE

JS="$(cat <<'JS'
const d = db.getSiblingDB("urine-disease-detection");

const k6Pattern =
    /^k6user(?:0[1-9]|10)@udetectupnvj\.com$/i;

const k6Users = d.users.find(
    { email: k6Pattern },
    { _id: 1, email: 1 }
).sort({ email: 1 }).toArray();

if (k6Users.length !== 10) {
    throw new Error(
        "User k6 bukan 10. Ditemukan: " +
        k6Users.length
    );
}

const k6Ids = k6Users.map(user => user._id);

const query = {
    user: {
        $in: k6Ids
    }
};

const before = d.predictions.countDocuments(
    query,
    { hint: "user_1" }
);

const totalBefore = Number(
    d.runCommand({
        collStats: "predictions"
    }).count
);

const nonK6Before = totalBefore - before;

printjson({
    mode:
        process.env.APPLY_DELETE === "YES"
            ? "APPLY"
            : "CHECK ONLY",
    predictionTotal: totalBefore,
    predictionK6AkanDihapus: before,
    predictionNonK6Dipertahankan: nonK6Before
});

if (process.env.APPLY_DELETE !== "YES") {
    print(
        "Belum ada data yang dihapus. " +
        "Gunakan --apply untuk menghapus."
    );
    quit(0);
}

const maxDelete = Number(process.env.MAX_DELETE);

if (before > maxDelete) {
    throw new Error(
        "ABORT: Jumlah k6 " +
        before +
        " melebihi batas aman " +
        maxDelete +
        "."
    );
}

const result = d.predictions.deleteMany(query);

const remainingK6 =
    d.predictions.countDocuments(query);

const totalAfter =
    d.predictions.countDocuments({});

printjson({
    deletedCount: result.deletedCount,
    predictionK6Tersisa: remainingK6,
    predictionTotalSekarang: totalAfter
});

if (remainingK6 !== 0) {
    throw new Error(
        "Masih ada prediction k6: " +
        remainingK6
    );
}

if (totalAfter !== nonK6Before) {
    throw new Error(
        "Jumlah akhir tidak sesuai. Expected=" +
        nonK6Before +
        ", actual=" +
        totalAfter
    );
}

print("CLEANUP K6 BERHASIL.");
JS
)"

mongosh "$URI" \
    --quiet \
    --eval "$JS"
