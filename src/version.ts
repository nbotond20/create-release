export class Version {
  year: string;
  month: string;
  _revision?: number;

  constructor(date: Date) {
    this.year = date.getFullYear().toString().substring(2);
    this.month = (date.getMonth() + 1).toString().padStart(2, "0");
  }

  get datePart() {
    return `${this.year}${this.month}`;
  }

  /**
   * @param {number} value
   */
  set revision(value: number) {
    this._revision = value;
  }

  toString() {
    return `v${this.datePart}.${this._revision ?? 1}`;
  }
}
